/**
 * Same-browser recovery for temporary Shiny deployments.
 *
 * The latest canvas JSON and immutable source blobs live in IndexedDB. After a
 * new Shiny session starts, the user may re-upload those blobs and the server
 * remaps expired asset IDs before loading the recovered project.
 */
(function () {
  "use strict";

  const DATABASE_NAME = "figforge-browser-recovery";
  const DATABASE_VERSION = 1;
  const ACTIVE_DRAFT_KEY = "active";
  const SAVE_DELAY_MS = 350;

  class BrowserRecovery {
    constructor() {
      this.assets = new Map();
      this.cachedAssetIds = new Set();
      this.pendingDraft = null;
      this.saveTimer = null;
      this.restoreDraft = null;
      this.restoring = false;
      this.handlersRegistered = false;
      this.bindControls();
      this.showAvailableDraft();
    }

    openDatabase() {
      if (!window.indexedDB) return Promise.reject(new Error("IndexedDB is unavailable"));
      return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("drafts")) database.createObjectStore("drafts");
          if (!database.objectStoreNames.contains("assets")) database.createObjectStore("assets");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not open browser storage"));
      });
    }

    async withStore(storeName, mode, operation) {
      const database = await this.openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let request;
        try {
          request = operation(store);
        } catch (error) {
          database.close();
          reject(error);
          return;
        }
        transaction.oncomplete = () => {
          database.close();
          resolve(request?.result);
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error || request?.error || new Error("Browser storage failed"));
        };
        transaction.onabort = transaction.onerror;
      });
    }

    getDraft() {
      return this.withStore("drafts", "readonly", (store) => store.get(ACTIVE_DRAFT_KEY));
    }

    scheduleDraft(name, state) {
      if (this.restoring || !state || (!state.images?.length && !state.template_frame)) return;
      this.pendingDraft = {
        format: "figforge-browser-draft",
        recovery_version: 1,
        name: String(name || "Untitled figure").trim() || "Untitled figure",
        state: structuredClone(state),
        assets: Array.from(this.assets.values(), (asset) => ({ ...asset })),
        updated_at: new Date().toISOString(),
      };
      window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => this.flushDraft(), SAVE_DELAY_MS);
    }

    async flushDraft() {
      const draft = this.pendingDraft;
      if (!draft) return;
      this.pendingDraft = null;
      try {
        await this.withStore("drafts", "readwrite", (store) => store.put(draft, ACTIVE_DRAFT_KEY));
        const requiredIds = (draft.state.images || []).map((image) => image.asset_id);
        const sourcesReady = requiredIds.every((assetId) => this.cachedAssetIds.has(assetId));
        this.setStatus(
          sourcesReady ? "Browser recovery saved" : "Caching source images…",
          sourcesReady ? "saved" : "saving",
        );
        if (navigator.storage?.persist) navigator.storage.persist().catch(() => false);
      } catch (error) {
        this.setStatus("Browser recovery unavailable", "error");
      }
    }

    async captureAsset(asset) {
      if (!asset?.asset_id || !asset?.source_url) return;
      const metadata = {
        asset_id: String(asset.asset_id),
        filename: String(asset.filename || "image"),
        mime_type: String(asset.mime_type || "application/octet-stream"),
      };
      this.assets.set(metadata.asset_id, metadata);
      try {
        const response = await fetch(asset.source_url, { cache: "no-store" });
        if (!response.ok) throw new Error("Source image could not be cached");
        const blob = await response.blob();
        await this.withStore("assets", "readwrite", (store) => store.put(
          { ...metadata, mime_type: blob.type || metadata.mime_type, blob },
          metadata.asset_id,
        ));
        this.cachedAssetIds.add(metadata.asset_id);
        const canvas = window.FigForgeCanvas;
        if (canvas) this.scheduleDraft(this.projectName(), canvas.state());
      } catch (error) {
        this.setStatus("Some images are not recoverable", "warning");
      }
    }

    recordProject(payload) {
      if (!payload?.state) return;
      for (const asset of payload.assets || []) {
        const metadata = {
          asset_id: String(asset.asset_id),
          filename: String(asset.filename || "image"),
          mime_type: String(asset.mime_type || "application/octet-stream"),
        };
        this.assets.set(metadata.asset_id, metadata);
        this.captureAsset(asset);
      }
      this.scheduleDraft(payload.name, payload.state);
    }

    projectName() {
      return document.getElementById("figure_name")?.value || "Untitled figure";
    }

    async showAvailableDraft() {
      try {
        const draft = await this.getDraft();
        if (!draft?.state || (!draft.state.images?.length && !draft.state.template_frame)) return;
        this.restoreDraft = draft;
        const banner = document.getElementById("browser_recovery_banner");
        const description = document.getElementById("browser_recovery_description");
        if (description) {
          const timestamp = new Date(draft.updated_at);
          const edited = Number.isNaN(timestamp.valueOf()) ? "recently" : timestamp.toLocaleString();
          description.textContent = `Continue “${draft.name}” from ${edited} on this browser?`;
        }
        banner?.classList.remove("is-hidden");
      } catch (error) {
        this.setStatus("Browser recovery unavailable", "error");
      }
    }

    bindControls() {
      document.getElementById("restore_browser_draft")?.addEventListener("click", () => this.restore());
      document.getElementById("discard_browser_draft")?.addEventListener("click", () => this.clear());
    }

    registerShinyHandlers() {
      if (this.handlersRegistered || !window.Shiny?.addCustomMessageHandler) return;
      window.Shiny.addCustomMessageHandler("figforge:recovery-ready", (payload) => {
        this.uploadRecoveryAssets(payload?.asset_ids || []);
      });
      window.Shiny.addCustomMessageHandler("figforge:recovery-complete", (payload) => {
        this.restoring = false;
        document.getElementById("browser_recovery_banner")?.classList.add("is-hidden");
        this.setStatus(payload?.label || "Recovered in this browser", "saved");
      });
      window.Shiny.addCustomMessageHandler("figforge:recovery-error", (payload) => {
        this.restoring = false;
        this.setStatus(payload?.message || "Recovery failed", "error");
      });
      this.handlersRegistered = true;
    }

    async restore() {
      if (this.restoring) return;
      const draft = this.restoreDraft || await this.getDraft().catch(() => null);
      if (!draft?.state) return;
      const requiredIds = [...new Set((draft.state.images || []).map((image) => image.asset_id))];
      for (const assetId of requiredIds) {
        const cached = await this.withStore("assets", "readonly", (store) => store.get(assetId)).catch(() => null);
        if (!cached?.blob) {
          this.setStatus("A source image is missing; open a .figforge backup", "error");
          return;
        }
      }
      this.restoring = true;
      this.setStatus("Restoring browser draft…", "saving");
      window.Shiny?.setInputValue(
        "browser_recovery_request",
        { ...draft, timestamp: Date.now() },
        { priority: "event" },
      );
    }

    async uploadRecoveryAssets(assetIds) {
      try {
        const transfer = new DataTransfer();
        for (const assetId of assetIds) {
          const cached = await this.withStore("assets", "readonly", (store) => store.get(assetId));
          if (!cached?.blob) throw new Error("A cached source image is missing");
          const extension = this.safeExtension(cached.filename, cached.mime_type);
          transfer.items.add(new File(
            [cached.blob],
            `ffrecover-${assetId}${extension}`,
            { type: cached.mime_type || cached.blob.type, lastModified: Date.now() },
          ));
        }
        const input = document.getElementById("recovery_upload");
        if (!input) throw new Error("Recovery upload control is unavailable");
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (error) {
        this.restoring = false;
        this.setStatus("Recovery could not re-upload source images", "error");
      }
    }

    safeExtension(filename, mimeType) {
      const match = String(filename || "").toLowerCase().match(/\.(png|jpe?g|tiff?)$/);
      if (match) return match[0];
      return mimeType === "image/tiff" ? ".tif" : mimeType === "image/jpeg" ? ".jpg" : ".png";
    }

    async clear() {
      window.clearTimeout(this.saveTimer);
      this.pendingDraft = null;
      this.restoreDraft = null;
      this.assets.clear();
      this.cachedAssetIds.clear();
      try {
        await Promise.all([
          this.withStore("drafts", "readwrite", (store) => store.clear()),
          this.withStore("assets", "readwrite", (store) => store.clear()),
        ]);
      } catch (error) {
        this.setStatus("Could not clear browser recovery", "error");
        return;
      }
      document.getElementById("browser_recovery_banner")?.classList.add("is-hidden");
      this.setStatus("Browser recovery cleared", "draft");
    }

    setStatus(message, state) {
      const status = document.getElementById("browser_recovery_status");
      if (!status) return;
      status.textContent = message;
      status.dataset.state = state || "draft";
    }
  }

  function initializeRecovery() {
    if (!window.FigForgeRecovery) window.FigForgeRecovery = new BrowserRecovery();
    window.FigForgeRecovery.registerShinyHandlers();
    return window.FigForgeRecovery;
  }

  document.addEventListener("DOMContentLoaded", initializeRecovery);
  document.addEventListener("shiny:connected", initializeRecovery);
})();
