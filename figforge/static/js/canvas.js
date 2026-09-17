/**
 * Browser-owned image canvas for FigForge.
 *
 * JavaScript -> Shiny
 *   canvas_state: schema-versioned canvas and non-destructive image transforms.
 *
 * Shiny -> JavaScript
 *   figforge:add-asset: validated asset metadata and its immutable local URL.
 */
(function () {
  "use strict";

  const SCHEMA_VERSION = 9;
  const MAX_LANES = 30;
  const DEFAULT_LANE_OPACITY = 0.35;
  const DEFAULT_GRID_LEFT = 0.05;
  const DEFAULT_GRID_RIGHT = 0.95;
  const MIN_GRID_SPAN = 0.04;
  const HANDLE_SIZE = 11;
  const MIN_IMAGE_SIZE = 36;
  const MIN_CROP_SIZE = 20;
  const SELECTION_COLOR = "#087f72";

  class FigureCanvas {
    constructor(canvas, container) {
      this.canvas = canvas;
      this.container = container;
      this.context = canvas.getContext("2d");
      this.emptyState = document.getElementById("canvas_empty_state");
      this.images = [];
      this.templateFrame = null;
      this.imageElements = new Map();
      this.laneGrids = new Map();
      this.labelRows = [];
      this.selectedId = null;
      this.selectedCell = null;
      this.selectionAnchor = null;
      this.editingCell = null;
      this.draggingSelection = false;
      this.pasteHorizontalPending = false;
      this.pasteHorizontalPendingTimeout = null;
      this.isLoadingProject = false;
      this.isApplyingHistory = false;
      this.undoStack = [];
      this.redoStack = [];
      this.interaction = null;
      this.cropMode = false;
      this.cropSessionStart = null;
      this.stageWidth = 0;
      this.stageHeight = 0;
      this.resizeObserver = new ResizeObserver(() => this.resize());

      this.bindEvents();
      this.resizeObserver.observe(container);
      this.resize();
    }

    bindEvents() {
      this.canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
      this.canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
      this.canvas.addEventListener("pointerup", (event) => this.pointerUp(event));
      this.canvas.addEventListener("pointercancel", (event) => this.pointerUp(event));

      document.addEventListener("keydown", (event) => {
        const target = event.target;
        const editingText = target instanceof HTMLInputElement
          || target instanceof HTMLTextAreaElement
          || target?.isContentEditable;
        const commandKey = event.ctrlKey || event.metaKey;
        if (event.key === "Escape" && this.cropMode && !editingText) {
          event.preventDefault();
          this.finishCrop(false);
          return;
        }
        if (commandKey && event.key.toLowerCase() === "z" && !editingText) {
          event.preventDefault();
          if (event.shiftKey) this.redo();
          else this.undo();
          return;
        }
        if (commandKey && event.key.toLowerCase() === "y" && !editingText) {
          event.preventDefault();
          this.redo();
          return;
        }
        if (editingText) return;
        if (target instanceof Element && target.closest("#label_grid_overlay")) return;
        if ((event.key === "Delete" || event.key === "Backspace") && this.selectedId) {
          event.preventDefault();
          this.deleteSelected();
        }
      });

      document.addEventListener("click", (event) => {
        if (event.target.closest("#new_project")) {
          window.FigForgeRecovery?.clear();
          window.Shiny?.setInputValue("new_project_request", Date.now(), { priority: "event" });
          return;
        }
        const assetButton = event.target.closest("[data-figforge-asset]");
        if (!assetButton) return;
        this.addAsset({
          asset_id: assetButton.dataset.assetId,
          filename: assetButton.dataset.filename,
          url: assetButton.dataset.url,
          source_url: assetButton.dataset.sourceUrl,
          width: Number(assetButton.dataset.width),
          height: Number(assetButton.dataset.height),
        });
      });

      document.getElementById("fit_image")?.addEventListener("click", () => this.fitSelected());
      document.getElementById("crop_tool")?.addEventListener("click", () => this.toggleCropMode());
      document.getElementById("reset_crop")?.addEventListener("click", () => this.resetCrop());
      document.getElementById("start_blank_template")?.addEventListener(
        "click",
        () => this.startBlankTemplate(),
      );
      document.getElementById("delete_image")?.addEventListener("click", () => this.deleteSelected());
      document.getElementById("undo_action")?.addEventListener("click", () => this.undo());
      document.getElementById("redo_action")?.addEventListener("click", () => this.redo());
      document.getElementById("toggle_lane_guides")?.addEventListener("click", () => this.toggleLaneGuides());
      document.getElementById("reset_lane_grid")?.addEventListener("click", () => this.resetLaneGrid());
      document.getElementById("lane_count")?.addEventListener("input", () => this.updateLaneCount());
      document.getElementById("lane_opacity")?.addEventListener("input", () => this.updateLaneOpacity());
      document.getElementById("add_row")?.addEventListener("click", () => this.addLabelRow("below"));
      document.getElementById("add_row_above")?.addEventListener("click", () => this.addLabelRow("above"));
      document.getElementById("add_row_below")?.addEventListener("click", () => this.addLabelRow("below"));
      document.getElementById("delete_label_row")?.addEventListener("click", () => this.deleteSelectedRow());
      document.getElementById("label_row_name")?.addEventListener("input", (event) => this.renameSelectedRow(event.target.value));
      document.getElementById("label_row_position")?.addEventListener("change", (event) => this.positionSelectedRow(event.target.value));
      document.getElementById("label_row_height")?.addEventListener("input", (event) => this.resizeSelectedRow(event.target.value));
      document.getElementById("merge_cells")?.addEventListener("click", () => this.toggleMergeSelected());
      document.getElementById("cell_borders")?.addEventListener("click", () => this.applyBorderPreset("all"));
      document.getElementById("rotate_object")?.addEventListener("click", () => this.cycleSelectedRotation());
      for (const [id, alignment] of [["align_left", "left"], ["align_center", "center"], ["align_right", "right"]]) {
        document.getElementById(id)?.addEventListener("click", () => this.applyCellProperty("align", alignment));
      }
      document.getElementById("cell_font_size")?.addEventListener("change", (event) => this.applyCellProperty("font_size", Number(event.target.value)));
      document.getElementById("cell_bold")?.addEventListener("click", () => this.toggleCellProperty("bold"));
      document.getElementById("cell_italic")?.addEventListener("click", () => this.toggleCellProperty("italic"));
      document.getElementById("cell_underline")?.addEventListener("click", () => this.toggleCellProperty("underline"));
      document.getElementById("cell_rotation")?.addEventListener("change", (event) => this.applyCellProperty("rotation", Number(event.target.value)));
      document.getElementById("cell_border_preset")?.addEventListener("change", (event) => this.applyBorderPreset(event.target.value));
      document.getElementById("cell_border_extension")?.addEventListener("change", (event) => {
        const parsed = Number(event.target.value);
        const length = Math.max(0, Math.min(500, Number.isFinite(parsed) ? parsed : 0));
        event.target.value = String(length);
        this.applyCellProperty("border_extension", length);
      });
      document.getElementById("cell_text_color")?.addEventListener(
        "change",
        (event) => this.applyCellProperty("text_color", event.target.value),
      );
      document.getElementById("cell_fill_color")?.addEventListener(
        "change",
        (event) => this.applyCellProperty("fill_color", event.target.value),
      );
      document.getElementById("reset_cell_colors")?.addEventListener("click", () => {
        const entries = this.selectedCellEntries();
        if (!entries.length) return;
        for (const { cell } of entries) {
          cell.text_color = "#102523";
          cell.fill_color = "#ffffff";
        }
        this.renderLabelRows();
        this.updateProperties();
        this.focusSelectedCell();
        this.syncState();
      });
      document.getElementById("fill_lane_numbers")?.addEventListener("click", () => this.fillLaneNumbers());
      document.getElementById("repeat_pattern")?.addEventListener("click", () => this.repeatSelectedPattern());
      document.getElementById("save_project")?.addEventListener("click", () => {
        this.setSaveStatus({ label: "Saving…", state: "saving" });
        window.Shiny?.setInputValue("save_project_request", Date.now(), { priority: "event" });
      });
      document.getElementById("export_figure")?.addEventListener("click", () => {
        window.Shiny?.setInputValue("export_figure_request", Date.now(), { priority: "event" });
      });
      document.addEventListener("change", (event) => {
        if (event.target?.id !== "export_format") return;
        const button = document.getElementById("download_figure");
        if (button) {
          button.textContent = `Download ${String(event.target.value).toUpperCase()} image`;
        }
      });
      document.getElementById("figure_name")?.addEventListener("input", (event) => {
        this.setSaveStatus({ label: "Editing…", state: "editing" });
        window.Shiny?.setInputValue(
          "project_name_change",
          { value: event.target.value, timestamp: Date.now() },
          { priority: "event" },
        );
        window.FigForgeRecovery?.scheduleDraft(event.target.value, this.state());
      });

      const labelOverlay = document.getElementById("label_grid_overlay");
      labelOverlay?.addEventListener("pointerdown", (event) => this.handleCellPointerDown(event));
      labelOverlay?.addEventListener("pointerover", (event) => this.handleCellPointerOver(event));
      labelOverlay?.addEventListener("pointermove", (event) => this.handleCellPointerOver(event));
      labelOverlay?.addEventListener("dblclick", (event) => this.handleCellDoubleClick(event));
      labelOverlay?.addEventListener("keydown", (event) => this.handleCellKeyDown(event));
      labelOverlay?.addEventListener("input", (event) => this.handleCellInput(event));
      labelOverlay?.addEventListener("focusout", (event) => this.handleCellBlur(event));
      labelOverlay?.addEventListener("paste", (event) => this.handleCellPaste(event));
      document.addEventListener("pointerup", () => { this.draggingSelection = false; });
    }

    resize() {
      const rectangle = this.container.getBoundingClientRect();
      const width = Math.max(1, Math.round(rectangle.width));
      const height = Math.max(1, Math.round(rectangle.height));
      const pixelRatio = window.devicePixelRatio || 1;

      this.stageWidth = width;
      this.stageHeight = height;
      this.canvas.width = Math.round(width * pixelRatio);
      this.canvas.height = Math.round(height * pixelRatio);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      this.draw();
    }

    addAsset(asset) {
      window.FigForgeRecovery?.captureAsset(asset);
      const existing = this.images.find((image) => image.asset_id === asset.asset_id);
      if (existing) {
        this.select(existing.image_id);
        return;
      }

      const imageElement = new Image();
      imageElement.decoding = "async";
      imageElement.onload = () => {
        const imageId = `image_${crypto.randomUUID()}`;
        let size = this.fittedSize(asset.width, asset.height, 0.72, 0.7);
        let x = Math.round((this.stageWidth - size.width) / 2);
        let y = Math.round((this.stageHeight - size.height) / 2);
        const template = this.templateFrame;
        if (template) {
          const scale = Math.min(template.width / asset.width, template.height / asset.height);
          size = {
            width: Math.max(MIN_IMAGE_SIZE, Math.round(asset.width * scale)),
            height: Math.max(MIN_IMAGE_SIZE, Math.round(asset.height * scale)),
          };
          x = Math.round(template.x + (template.width - size.width) / 2);
          y = Math.round(template.y + (template.height - size.height) / 2);
        }
        const image = {
          image_id: imageId,
          asset_id: asset.asset_id,
          filename: asset.filename,
          source_url: asset.source_url || asset.url,
          display_url: asset.url,
          original_width: asset.width,
          original_height: asset.height,
          x,
          y,
          width: size.width,
          height: size.height,
          crop: {
            x: 0,
            y: 0,
            width: asset.width,
            height: asset.height,
          },
          rotation: 0,
        };
        if (template) {
          const grid = this.laneGrids.get(template.image_id);
          this.laneGrids.delete(template.image_id);
          if (grid) {
            grid.image_id = imageId;
            this.laneGrids.set(imageId, grid);
          }
          for (const row of this.labelRows.filter((candidate) => candidate.image_id === template.image_id)) {
            row.image_id = imageId;
          }
          this.templateFrame = null;
        }
        this.imageElements.set(imageId, imageElement);
        this.images.push(image);
        this.select(imageId);
        this.syncState();
      };
      imageElement.onerror = () => this.showCanvasError(`Could not display ${asset.filename}`);
      imageElement.src = asset.url;
    }

    startBlankTemplate() {
      if (this.images.length || this.templateFrame) {
        this.showLabelStatus("Start a new project before creating a blank template.", "error");
        return;
      }
      const width = Math.max(120, Math.min(this.stageWidth - 32, Math.round(this.stageWidth * 0.72)));
      const height = Math.max(100, Math.min(this.stageHeight - 80, Math.round(this.stageHeight * 0.48)));
      this.templateFrame = {
        image_id: `template_${crypto.randomUUID()}`,
        x: Math.round((this.stageWidth - width) / 2),
        y: Math.round((this.stageHeight - height) / 2),
        width,
        height,
        is_template: true,
      };
      this.createLaneGrid(this.templateFrame, true);
      this.select(this.templateFrame.image_id);
      this.syncState();
      this.showLabelStatus("Blank template ready. Add rows now or upload an image later.", "success");
    }

    async loadProject(payload) {
      this.isLoadingProject = true;
      window.FigForgeRecovery?.recordProject(payload);
      this.finishEditing(false);
      this.images = (payload.state?.images || []).map((image) => ({
        ...image,
        crop: image.crop
          ? { ...image.crop }
          : {
            x: 0,
            y: 0,
            width: image.original_width,
            height: image.original_height,
          },
      }));
      this.templateFrame = payload.state?.template_frame
        ? { ...payload.state.template_frame, is_template: true }
        : null;
      this.imageElements.clear();
      this.laneGrids = new Map(
        (payload.state?.lane_grids || []).map((grid) => [
          grid.image_id,
          { ...grid, boundaries: [...(grid.boundaries || [])] },
        ]),
      );
      this.labelRows = (payload.state?.label_rows || []).map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          rowspan: Number(cell.rowspan || 1),
          merged_into_row: cell.merged_into_row ?? null,
          text_color: cell.text_color || "#102523",
          fill_color: cell.fill_color || "#ffffff",
          border_extension: Number(cell.border_extension || 0),
          borders: { ...cell.borders },
        })),
      }));
      this.selectedId = this.images[0]?.image_id || this.templateFrame?.image_id || null;
      this.selectedCell = null;
      this.selectionAnchor = null;
      this.editingCell = null;
      this.interaction = null;
      this.cropMode = false;
      this.cropSessionStart = null;
      this.undoStack = [];
      this.redoStack = [];
      this.updateHistoryControls();

      await Promise.all(
        this.images.map((image) => new Promise((resolve) => {
          const element = new Image();
          element.decoding = "async";
          element.onload = () => {
            this.imageElements.set(image.image_id, element);
            resolve();
          };
          element.onerror = () => {
            this.showCanvasError(`Could not reopen ${image.filename}`);
            resolve();
          };
          element.src = image.display_url;
        })),
      );

      const name = document.getElementById("figure_name");
      if (name) name.value = payload.name || "Untitled figure";
      this.renderLabelRows();
      this.draw();
      this.updateProperties();
      this.isLoadingProject = false;
      this.setSaveStatus({ label: "Saved", state: "saved" });
    }

    fittedSize(originalWidth, originalHeight, widthFraction, heightFraction) {
      const widthLimit = this.stageWidth * widthFraction;
      const heightLimit = this.stageHeight * heightFraction;
      const scale = Math.min(1, widthLimit / originalWidth, heightLimit / originalHeight);
      return {
        width: Math.max(MIN_IMAGE_SIZE, Math.round(originalWidth * scale)),
        height: Math.max(MIN_IMAGE_SIZE, Math.round(originalHeight * scale)),
      };
    }

    fitSelected() {
      const image = this.selectedImage();
      if (!image) return;
      if (image.is_template) {
        image.width = Math.max(120, Math.round(this.stageWidth * 0.86));
        image.height = Math.max(100, Math.round(this.stageHeight * 0.58));
        image.x = Math.round((this.stageWidth - image.width) / 2);
        image.y = Math.round((this.stageHeight - image.height) / 2);
        this.draw();
        this.updateProperties();
        this.syncState();
        return;
      }
      const crop = this.imageCrop(image);
      const size = this.fittedSize(crop.width, crop.height, 0.86, 0.82);
      image.width = size.width;
      image.height = size.height;
      image.x = Math.round((this.stageWidth - size.width) / 2);
      image.y = Math.round((this.stageHeight - size.height) / 2);
      this.draw();
      this.updateProperties();
      this.syncState();
    }

    imageCrop(image) {
      return image.crop || {
        x: 0,
        y: 0,
        width: image.original_width,
        height: image.original_height,
      };
    }

    isCropped(image) {
      if (!image || image.is_template) return false;
      const crop = this.imageCrop(image);
      return crop.x > 0.001
        || crop.y > 0.001
        || crop.width < image.original_width - 0.001
        || crop.height < image.original_height - 0.001;
    }

    toggleCropMode() {
      if (this.cropMode) {
        this.finishCrop(true);
        return;
      }
      const image = this.selectedImage();
      if (!image || image.is_template) return;
      this.cropMode = true;
      const grid = this.laneGrids.get(image.image_id);
      this.cropSessionStart = {
        image_id: image.image_id,
        x: image.x,
        y: image.y,
        width: image.width,
        height: image.height,
        crop: { ...this.imageCrop(image) },
        grid: grid ? { ...grid, boundaries: [...grid.boundaries] } : null,
      };
      this.updateCropControls();
      this.draw();
      this.canvas.focus({ preventScroll: true });
    }

    finishCrop(commit) {
      if (!this.cropMode) return;
      const snapshot = this.cropSessionStart;
      const image = snapshot
        ? this.images.find((candidate) => candidate.image_id === snapshot.image_id)
        : null;
      if (!commit && image && snapshot) {
        Object.assign(image, {
          x: snapshot.x,
          y: snapshot.y,
          width: snapshot.width,
          height: snapshot.height,
          crop: { ...snapshot.crop },
        });
        if (snapshot.grid) {
          this.laneGrids.set(
            snapshot.image_id,
            { ...snapshot.grid, boundaries: [...snapshot.grid.boundaries] },
          );
        }
      }
      this.cropMode = false;
      this.cropSessionStart = null;
      this.interaction = null;
      this.updateCropControls();
      this.draw();
      this.updateProperties();
      this.syncState();
    }

    resetCrop() {
      const image = this.selectedImage();
      if (!image || image.is_template || !this.isCropped(image)) return;
      const crop = this.imageCrop(image);
      const scaleX = image.width / crop.width;
      const scaleY = image.height / crop.height;
      image.x -= crop.x * scaleX;
      image.y -= crop.y * scaleY;
      image.width = image.original_width * scaleX;
      image.height = image.original_height * scaleY;
      image.crop = {
        x: 0,
        y: 0,
        width: image.original_width,
        height: image.original_height,
      };
      this.draw();
      this.updateProperties();
      if (!this.cropMode) this.syncState();
    }

    updateCropControls() {
      const image = this.selectedImage();
      const cropButton = document.getElementById("crop_tool");
      if (cropButton) {
        cropButton.disabled = !this.cropMode && (!image || image.is_template);
      }
      cropButton?.classList.toggle("tool-button--active", this.cropMode);
      if (cropButton) {
        const label = cropButton.querySelector("span:last-child");
        if (label) label.textContent = this.cropMode ? "Done" : "Crop";
        cropButton.title = this.cropMode
          ? "Apply crop (Escape cancels)"
          : "Crop the selected image non-destructively";
      }
      document.getElementById("reset_crop")?.toggleAttribute(
        "disabled",
        !this.isCropped(image),
      );
    }

    deleteSelected() {
      if (this.cropMode) this.finishCrop(true);
      if (!this.selectedId) return;
      const deleteId = this.selectedId;
      const imageIndex = this.images.findIndex((image) => image.image_id === deleteId);
      const image = this.images[imageIndex];
      if (!image) return;
      const grid = this.laneGrids.get(deleteId);
      const command = {
        type: "delete-image",
        image: { ...image },
        imageIndex,
        imageElement: this.imageElements.get(deleteId) || null,
        grid: grid ? { ...grid, boundaries: [...grid.boundaries] } : null,
        rows: this.labelRows
          .map((row, index) => ({ row, index }))
          .filter(({ row }) => row.image_id === deleteId)
          .map(({ row, index }) => ({
            index,
            row: {
              ...row,
              cells: row.cells.map((cell) => ({
                ...cell,
                borders: { ...cell.borders },
              })),
            },
          })),
      };
      this.applyDeleteCommand(command);
      this.undoStack.push(command);
      this.redoStack = [];
      this.updateHistoryControls();
      this.syncState(true);
    }

    applyDeleteCommand(command) {
      const deleteId = command.image.image_id;
      this.images = this.images.filter((image) => image.image_id !== deleteId);
      this.imageElements.delete(deleteId);
      this.laneGrids.delete(deleteId);
      this.labelRows = this.labelRows.filter((row) => row.image_id !== deleteId);
      this.selectedCell = null;
      this.selectionAnchor = null;
      this.editingCell = null;
      this.selectedId = null;
      this.draw();
      this.updateProperties();
      this.renderLabelRows();
    }

    undo() {
      const command = this.undoStack.pop();
      if (!command) return;
      this.isApplyingHistory = true;
      if (command.type === "delete-image") {
        this.images.splice(
          Math.min(command.imageIndex, this.images.length),
          0,
          { ...command.image },
        );
        if (command.imageElement) {
          this.imageElements.set(command.image.image_id, command.imageElement);
        } else {
          const element = new Image();
          element.decoding = "async";
          element.onload = () => {
            this.imageElements.set(command.image.image_id, element);
            this.draw();
          };
          element.src = command.image.display_url;
        }
        if (command.grid) {
          this.laneGrids.set(
            command.image.image_id,
            { ...command.grid, boundaries: [...command.grid.boundaries] },
          );
        }
        for (const item of command.rows) {
          this.labelRows.splice(
            Math.min(item.index, this.labelRows.length),
            0,
            {
              ...item.row,
              cells: item.row.cells.map((cell) => ({
                ...cell,
                borders: { ...cell.borders },
              })),
            },
          );
        }
        this.selectedId = command.image.image_id;
      } else if (command.type === "label-edit") {
        this.restoreLabelState(command.before);
        this.focusSelectedCell();
      }
      this.redoStack.push(command);
      this.renderLabelRows();
      this.updateCellSelection();
      this.draw();
      this.updateProperties();
      this.updateHistoryControls();
      this.syncState(true);
      this.isApplyingHistory = false;
    }

    redo() {
      const command = this.redoStack.pop();
      if (!command) return;
      this.isApplyingHistory = true;
      if (command.type === "delete-image") {
        this.applyDeleteCommand(command);
      } else if (command.type === "label-edit") {
        this.restoreLabelState(command.after);
        this.renderLabelRows();
        this.updateCellSelection();
        this.focusSelectedCell();
        this.draw();
        this.updateProperties();
      }
      this.undoStack.push(command);
      this.updateHistoryControls();
      this.syncState(true);
      this.isApplyingHistory = false;
    }

    updateHistoryControls() {
      document.getElementById("undo_action")?.toggleAttribute(
        "disabled",
        this.undoStack.length === 0,
      );
      document.getElementById("redo_action")?.toggleAttribute(
        "disabled",
        this.redoStack.length === 0,
      );
    }

    snapshotLabelState() {
      return {
        rows: this.labelRows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({ ...cell, borders: { ...cell.borders } })),
        })),
        selectedId: this.selectedId,
        selectedCell: this.selectedCell ? { ...this.selectedCell } : null,
        selectionAnchor: this.selectionAnchor ? { ...this.selectionAnchor } : null,
      };
    }

    restoreLabelState(snapshot) {
      this.labelRows = snapshot.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({ ...cell, borders: { ...cell.borders } })),
      }));
      this.selectedId = snapshot.selectedId;
      this.selectedCell = snapshot.selectedCell ? { ...snapshot.selectedCell } : null;
      this.selectionAnchor = snapshot.selectionAnchor ? { ...snapshot.selectionAnchor } : null;
    }

    beginLabelHistory() {
      return this.snapshotLabelState();
    }

    commitLabelHistory(before) {
      const after = this.snapshotLabelState();
      if (JSON.stringify(before.rows) !== JSON.stringify(after.rows)) {
        this.undoStack.push({ type: "label-edit", before, after });
        this.redoStack = [];
        this.updateHistoryControls();
      }
      this.syncState(true);
    }

    select(imageId) {
      if (this.cropMode && imageId !== this.selectedId) this.finishCrop(true);
      this.finishEditing(true);
      this.selectedCell = null;
      this.selectionAnchor = null;
      this.selectedId = imageId;
      this.canvas.focus({ preventScroll: true });
      this.draw();
      this.updateProperties();
      this.updateCellSelection();
    }

    selectedImage() {
      return this.images.find((image) => image.image_id === this.selectedId)
        || (this.templateFrame?.image_id === this.selectedId ? this.templateFrame : null);
    }

    surfaces() {
      return this.templateFrame ? [this.templateFrame, ...this.images] : [...this.images];
    }

    selectedGrid() {
      const image = this.selectedImage();
      return image ? this.laneGrids.get(image.image_id) || null : null;
    }

    readLaneCount() {
      const input = document.getElementById("lane_count");
      const parsed = Number.parseInt(input?.value || "30", 10);
      const laneCount = Math.max(1, Math.min(MAX_LANES, Number.isFinite(parsed) ? parsed : 1));
      if (input) input.value = String(laneCount);
      return laneCount;
    }

    readLaneOpacity() {
      const input = document.getElementById("lane_opacity");
      const parsed = Number.parseFloat(input?.value || String(DEFAULT_LANE_OPACITY));
      return Math.max(0.1, Math.min(0.8, Number.isFinite(parsed) ? parsed : DEFAULT_LANE_OPACITY));
    }

    createLaneGrid(image, visible = true) {
      const grid = {
        image_id: image.image_id,
        lane_count: this.readLaneCount(),
        left: DEFAULT_GRID_LEFT,
        right: DEFAULT_GRID_RIGHT,
        uniform: true,
        boundaries: [],
        visible,
        opacity: this.readLaneOpacity(),
      };
      this.laneGrids.set(image.image_id, grid);
      return grid;
    }

    toggleLaneGuides() {
      const image = this.selectedImage();
      if (!image) return;
      const grid = this.selectedGrid() || this.createLaneGrid(image, false);
      grid.lane_count = this.readLaneCount();
      grid.opacity = this.readLaneOpacity();
      grid.visible = !grid.visible;
      this.resizeRowsForGrid(image.image_id, grid.lane_count);
      this.draw();
      this.updateLaneControls(image);
      this.syncState();
    }

    resetLaneGrid() {
      const image = this.selectedImage();
      if (!image) return;
      const existing = this.selectedGrid();
      const grid = existing || this.createLaneGrid(image, true);
      grid.lane_count = this.readLaneCount();
      grid.left = DEFAULT_GRID_LEFT;
      grid.right = DEFAULT_GRID_RIGHT;
      grid.uniform = true;
      grid.boundaries = [];
      grid.opacity = this.readLaneOpacity();
      grid.visible = existing ? existing.visible : true;
      this.resizeRowsForGrid(image.image_id, grid.lane_count);
      this.draw();
      this.updateLaneControls(image);
      this.syncState();
    }

    updateLaneCount() {
      const laneCount = this.readLaneCount();
      const grid = this.selectedGrid();
      if (!grid) return;
      const previousLaneCount = grid.lane_count;
      grid.lane_count = laneCount;
      grid.uniform = true;
      grid.boundaries = [];
      if (this.templateFrame?.image_id === grid.image_id) {
        this.adaptTemplateRows(grid.image_id, previousLaneCount, laneCount);
      } else {
        this.resizeRowsForGrid(grid.image_id, laneCount);
      }
      this.draw();
      this.syncState();
    }

    updateLaneOpacity() {
      const opacity = this.readLaneOpacity();
      const output = document.getElementById("lane_opacity_value");
      if (output) output.textContent = `${Math.round(opacity * 100)}%`;
      const grid = this.selectedGrid();
      if (!grid) return;
      grid.opacity = opacity;
      this.draw();
      this.syncState();
    }

    pointerPosition(event) {
      const rectangle = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top };
    }

    pointerDown(event) {
      const point = this.pointerPosition(event);
      const selected = this.selectedImage();
      const grid = this.selectedGrid();
      const gridBoundary = selected && grid ? this.laneBoundaryAt(point, selected, grid) : null;
      const handle = selected ? this.handleAt(point, selected) : null;

      if (this.cropMode && selected && !selected.is_template) {
        const cropHandle = this.cropHandleAt(point, selected);
        if (cropHandle) {
          this.interaction = {
            type: "crop",
            handle: cropHandle,
            startPoint: point,
            start: { ...selected, crop: { ...this.imageCrop(selected) } },
            fullBounds: this.fullImageBounds(selected),
            gridBounds: grid
              ? {
                left: selected.x + selected.width * grid.left,
                right: selected.x + selected.width * grid.right,
              }
              : null,
          };
          this.canvas.setPointerCapture(event.pointerId);
          event.preventDefault();
        }
        return;
      }

      if (selected && grid && gridBoundary) {
        this.interaction = {
          type: "lane-boundary",
          boundary: gridBoundary,
          startPoint: point,
        };
      } else if (selected && handle) {
        this.interaction = { type: "resize", handle, startPoint: point, start: { ...selected } };
      } else {
        const hit = this.hitImage(point);
        if (hit) {
          this.select(hit.image_id);
          this.interaction = { type: "move", startPoint: point, start: { ...hit } };
        } else {
          this.finishEditing(true);
          this.selectedCell = null;
          this.selectionAnchor = null;
          this.selectedId = null;
          this.interaction = null;
          this.draw();
          this.updateProperties();
          this.updateCellSelection();
        }
      }

      if (this.interaction) {
        this.canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
    }

    pointerMove(event) {
      const point = this.pointerPosition(event);
      if (!this.interaction) {
        this.updateCursor(point);
        return;
      }

      const image = this.selectedImage();
      if (!image) return;
      const deltaX = point.x - this.interaction.startPoint.x;
      const deltaY = point.y - this.interaction.startPoint.y;

      if (this.interaction.type === "crop") {
        this.cropFromHandle(
          image,
          this.interaction.start,
          this.interaction.fullBounds,
          this.interaction.gridBounds,
          this.interaction.handle,
          deltaX,
          deltaY,
        );
      } else if (this.interaction.type === "lane-boundary") {
        const grid = this.selectedGrid();
        if (!grid) return;
        const normalized = Math.max(0, Math.min(1, (point.x - image.x) / image.width));
        if (this.interaction.boundary === "left") {
          grid.left = Math.min(normalized, grid.right - MIN_GRID_SPAN);
        } else {
          grid.right = Math.max(normalized, grid.left + MIN_GRID_SPAN);
        }
      } else if (this.interaction.type === "move") {
        image.x = Math.round(this.interaction.start.x + deltaX);
        image.y = Math.round(this.interaction.start.y + deltaY);
      } else {
        this.resizeFromHandle(image, this.interaction.start, this.interaction.handle, deltaX, deltaY);
      }
      this.draw();
      this.updateProperties();
    }

    pointerUp(event) {
      if (!this.interaction) return;
      const interactionType = this.interaction.type;
      this.interaction = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      if (interactionType !== "crop") this.syncState();
      this.updateCursor(this.pointerPosition(event));
    }

    fullImageBounds(image) {
      const crop = this.imageCrop(image);
      const scaleX = image.width / crop.width;
      const scaleY = image.height / crop.height;
      return {
        x: image.x - crop.x * scaleX,
        y: image.y - crop.y * scaleY,
        width: image.original_width * scaleX,
        height: image.original_height * scaleY,
      };
    }

    cropFromHandle(image, start, fullBounds, gridBounds, handle, deltaX, deltaY) {
      const startRight = start.x + start.width;
      const startBottom = start.y + start.height;
      let left = start.x;
      let top = start.y;
      let right = startRight;
      let bottom = startBottom;
      if (handle.includes("left")) {
        left = Math.max(fullBounds.x, Math.min(startRight - MIN_CROP_SIZE, start.x + deltaX));
      }
      if (handle.includes("right")) {
        right = Math.min(
          fullBounds.x + fullBounds.width,
          Math.max(start.x + MIN_CROP_SIZE, startRight + deltaX),
        );
      }
      if (handle.includes("top")) {
        top = Math.max(fullBounds.y, Math.min(startBottom - MIN_CROP_SIZE, start.y + deltaY));
      }
      if (handle.includes("bottom")) {
        bottom = Math.min(
          fullBounds.y + fullBounds.height,
          Math.max(start.y + MIN_CROP_SIZE, startBottom + deltaY),
        );
      }
      image.x = left;
      image.y = top;
      image.width = right - left;
      image.height = bottom - top;
      image.crop = {
        x: Math.max(0, (left - fullBounds.x) / fullBounds.width * image.original_width),
        y: Math.max(0, (top - fullBounds.y) / fullBounds.height * image.original_height),
        width: Math.min(
          image.original_width,
          (right - left) / fullBounds.width * image.original_width,
        ),
        height: Math.min(
          image.original_height,
          (bottom - top) / fullBounds.height * image.original_height,
        ),
      };
      const grid = this.laneGrids.get(image.image_id);
      if (grid && gridBounds && image.width > 0) {
        const gridLeft = Math.max(image.x, Math.min(image.x + image.width, gridBounds.left));
        const gridRight = Math.max(image.x, Math.min(image.x + image.width, gridBounds.right));
        if (gridRight - gridLeft >= MIN_GRID_SPAN * image.width) {
          grid.left = (gridLeft - image.x) / image.width;
          grid.right = (gridRight - image.x) / image.width;
        }
      }
    }

    resizeFromHandle(image, start, handle, deltaX, deltaY) {
      const horizontalSign = handle.includes("right") ? 1 : -1;
      const verticalSign = handle.includes("bottom") ? 1 : -1;
      const widthFromX = start.width + horizontalSign * deltaX;
      const heightFromY = start.height + verticalSign * deltaY;
      const aspectRatio = start.width / start.height;
      let width;
      let height;

      if (Math.abs(deltaX) >= Math.abs(deltaY * aspectRatio)) {
        width = Math.max(MIN_IMAGE_SIZE, widthFromX);
        height = width / aspectRatio;
      } else {
        height = Math.max(MIN_IMAGE_SIZE, heightFromY);
        width = height * aspectRatio;
      }

      image.width = Math.round(width);
      image.height = Math.round(height);
      image.x = handle.includes("left") ? Math.round(start.x + start.width - width) : start.x;
      image.y = handle.includes("top") ? Math.round(start.y + start.height - height) : start.y;
    }

    hitImage(point) {
      const surfaces = this.surfaces();
      for (let index = surfaces.length - 1; index >= 0; index -= 1) {
        const image = surfaces[index];
        if (point.x >= image.x && point.x <= image.x + image.width && point.y >= image.y && point.y <= image.y + image.height) return image;
      }
      return null;
    }

    laneBoundaryAt(point, image, grid) {
      if (!grid.visible || point.y < image.y || point.y > image.y + image.height) return null;
      const leftX = image.x + image.width * grid.left;
      const rightX = image.x + image.width * grid.right;
      if (Math.abs(point.x - leftX) <= 8) return "left";
      if (Math.abs(point.x - rightX) <= 8) return "right";
      return null;
    }

    handles(image) {
      return {
        "top-left": { x: image.x, y: image.y },
        "top-right": { x: image.x + image.width, y: image.y },
        "bottom-left": { x: image.x, y: image.y + image.height },
        "bottom-right": { x: image.x + image.width, y: image.y + image.height },
      };
    }

    handleAt(point, image) {
      for (const [name, handle] of Object.entries(this.handles(image))) {
        if (Math.abs(point.x - handle.x) <= HANDLE_SIZE && Math.abs(point.y - handle.y) <= HANDLE_SIZE) return name;
      }
      return null;
    }

    cropHandles(image) {
      const centerX = image.x + image.width / 2;
      const centerY = image.y + image.height / 2;
      return {
        "top-left": { x: image.x, y: image.y },
        top: { x: centerX, y: image.y },
        "top-right": { x: image.x + image.width, y: image.y },
        left: { x: image.x, y: centerY },
        right: { x: image.x + image.width, y: centerY },
        "bottom-left": { x: image.x, y: image.y + image.height },
        bottom: { x: centerX, y: image.y + image.height },
        "bottom-right": { x: image.x + image.width, y: image.y + image.height },
      };
    }

    cropHandleAt(point, image) {
      for (const [name, handle] of Object.entries(this.cropHandles(image))) {
        if (
          Math.abs(point.x - handle.x) <= HANDLE_SIZE
          && Math.abs(point.y - handle.y) <= HANDLE_SIZE
        ) return name;
      }
      return null;
    }

    updateCursor(point) {
      const selected = this.selectedImage();
      if (this.cropMode && selected && !selected.is_template) {
        const cropHandle = this.cropHandleAt(point, selected);
        if (!cropHandle) {
          this.canvas.style.cursor = "crosshair";
        } else if (cropHandle === "left" || cropHandle === "right") {
          this.canvas.style.cursor = "ew-resize";
        } else if (cropHandle === "top" || cropHandle === "bottom") {
          this.canvas.style.cursor = "ns-resize";
        } else {
          this.canvas.style.cursor = cropHandle === "top-left" || cropHandle === "bottom-right"
            ? "nwse-resize"
            : "nesw-resize";
        }
        return;
      }
      const grid = this.selectedGrid();
      const boundary = selected && grid ? this.laneBoundaryAt(point, selected, grid) : null;
      const handle = selected ? this.handleAt(point, selected) : null;
      if (boundary) {
        this.canvas.style.cursor = "col-resize";
      } else if (handle) {
        this.canvas.style.cursor = handle === "top-left" || handle === "bottom-right" ? "nwse-resize" : "nesw-resize";
      } else if (this.hitImage(point)) {
        this.canvas.style.cursor = "move";
      } else {
        this.canvas.style.cursor = "default";
      }
    }

    draw() {
      this.context.clearRect(0, 0, this.stageWidth, this.stageHeight);
      if (this.templateFrame) {
        this.drawTemplateFrame(this.templateFrame);
        const templateGrid = this.laneGrids.get(this.templateFrame.image_id);
        if (templateGrid?.visible) {
          this.drawLaneGrid(
            this.templateFrame,
            templateGrid,
            this.templateFrame.image_id === this.selectedId,
          );
        }
      }
      for (const image of this.images) {
        const element = this.imageElements.get(image.image_id);
        if (element) this.drawCroppedImage(element, image);
        const grid = this.laneGrids.get(image.image_id);
        if (grid?.visible) this.drawLaneGrid(image, grid, image.image_id === this.selectedId);
      }
      const selected = this.selectedImage();
      if (selected) {
        if (this.cropMode && !selected.is_template) this.drawCropSelection(selected);
        else this.drawSelection(selected);
      }
      this.emptyState?.classList.toggle("is-hidden", this.surfaces().length > 0);
      this.positionLabelRows();
    }

    drawCroppedImage(element, image) {
      const crop = this.imageCrop(image);
      const scaleX = element.naturalWidth / image.original_width;
      const scaleY = element.naturalHeight / image.original_height;
      this.context.drawImage(
        element,
        crop.x * scaleX,
        crop.y * scaleY,
        crop.width * scaleX,
        crop.height * scaleY,
        image.x,
        image.y,
        image.width,
        image.height,
      );
    }

    drawTemplateFrame(frame) {
      this.context.save();
      this.context.fillStyle = "rgba(239, 246, 244, 0.92)";
      this.context.fillRect(frame.x, frame.y, frame.width, frame.height);
      this.context.strokeStyle = "#7f9b96";
      this.context.lineWidth = 2;
      this.context.setLineDash([8, 6]);
      this.context.strokeRect(frame.x, frame.y, frame.width, frame.height);
      this.context.setLineDash([]);
      this.context.textAlign = "center";
      this.context.textBaseline = "middle";
      this.context.fillStyle = "#385a55";
      this.context.font = "600 14px system-ui, sans-serif";
      this.context.fillText(
        "Template image area",
        frame.x + frame.width / 2,
        frame.y + frame.height / 2 - 10,
      );
      this.context.fillStyle = "#66817d";
      this.context.font = "11px system-ui, sans-serif";
      this.context.fillText(
        "Upload an image later to attach it",
        frame.x + frame.width / 2,
        frame.y + frame.height / 2 + 12,
      );
      this.context.restore();
    }

    drawLaneGrid(image, grid, selected) {
      const leftX = image.x + image.width * grid.left;
      const rightX = image.x + image.width * grid.right;
      const laneWidth = (rightX - leftX) / grid.lane_count;
      const top = image.y;
      const bottom = image.y + image.height;

      this.context.save();
      this.context.fillStyle = `rgba(19, 211, 185, ${grid.opacity * 0.11})`;
      for (let lane = 0; lane < grid.lane_count; lane += 2) {
        this.context.fillRect(leftX + lane * laneWidth, top, laneWidth, image.height);
      }

      this.context.strokeStyle = `rgba(26, 224, 196, ${grid.opacity})`;
      this.context.lineWidth = 1;
      for (let lane = 1; lane < grid.lane_count; lane += 1) {
        const x = leftX + lane * laneWidth;
        this.context.beginPath();
        this.context.moveTo(x, top);
        this.context.lineTo(x, bottom);
        this.context.stroke();
      }

      this.context.strokeStyle = `rgba(0, 154, 135, ${Math.min(1, grid.opacity + 0.35)})`;
      this.context.lineWidth = 3;
      for (const x of [leftX, rightX]) {
        this.context.beginPath();
        this.context.moveTo(x, top);
        this.context.lineTo(x, bottom);
        this.context.stroke();
      }

      if (selected) {
        const handleY = top + image.height / 2;
        for (const x of [leftX, rightX]) {
          this.context.fillStyle = "rgba(255, 255, 255, 0.94)";
          this.context.strokeStyle = SELECTION_COLOR;
          this.context.lineWidth = 2;
          this.context.fillRect(x - 5, handleY - 15, 10, 30);
          this.context.strokeRect(x - 5, handleY - 15, 10, 30);
        }
      }
      this.context.restore();
    }

    drawSelection(image) {
      this.context.save();
      this.context.strokeStyle = SELECTION_COLOR;
      this.context.lineWidth = 2;
      this.context.setLineDash([6, 4]);
      this.context.strokeRect(image.x, image.y, image.width, image.height);
      this.context.setLineDash([]);

      for (const handle of Object.values(this.handles(image))) {
        this.context.fillStyle = "#ffffff";
        this.context.strokeStyle = SELECTION_COLOR;
        this.context.lineWidth = 2;
        this.context.fillRect(handle.x - HANDLE_SIZE / 2, handle.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        this.context.strokeRect(handle.x - HANDLE_SIZE / 2, handle.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      }
      this.context.restore();
    }

    drawCropSelection(image) {
      this.context.save();
      this.context.strokeStyle = SELECTION_COLOR;
      this.context.lineWidth = 2;
      this.context.strokeRect(image.x, image.y, image.width, image.height);
      for (const handle of Object.values(this.cropHandles(image))) {
        this.context.fillStyle = "#ffffff";
        this.context.strokeStyle = SELECTION_COLOR;
        this.context.fillRect(
          handle.x - HANDLE_SIZE / 2,
          handle.y - HANDLE_SIZE / 2,
          HANDLE_SIZE,
          HANDLE_SIZE,
        );
        this.context.strokeRect(
          handle.x - HANDLE_SIZE / 2,
          handle.y - HANDLE_SIZE / 2,
          HANDLE_SIZE,
          HANDLE_SIZE,
        );
      }
      this.context.restore();
    }

    updateProperties() {
      const image = this.selectedImage();
      const values = image
        ? { prop_x: Math.round(image.x), prop_y: Math.round(image.y), prop_width: Math.round(image.width), prop_height: Math.round(image.height) }
        : { prop_x: "—", prop_y: "—", prop_width: "—", prop_height: "—" };

      for (const [id, value] of Object.entries(values)) {
        const field = document.getElementById(id);
        if (field) field.value = value;
      }

      const label = document.getElementById("selected_object_label");
      if (label) label.textContent = image
        ? image.is_template ? "Blank template surface" : image.filename
        : "Nothing selected";
      document.getElementById("fit_image")?.toggleAttribute("disabled", !image);
      const deleteButton = document.getElementById("delete_image");
      if (deleteButton) deleteButton.disabled = !image || Boolean(image.is_template);
      document.getElementById("add_row")?.toggleAttribute("disabled", !image);
      this.updateCropControls();
      this.updateLaneControls(image);
      this.updateRowControls(image);
      this.updateFormattingControls();
      this.updateProductivityControls();

      document.querySelectorAll("[data-figforge-asset]").forEach((button) => {
        button.classList.toggle(
          "is-active",
          Boolean(image && !image.is_template && button.dataset.assetId === image.asset_id),
        );
      });
    }

    updateLaneControls(image) {
      const grid = image ? this.laneGrids.get(image.image_id) || null : null;
      const laneCount = document.getElementById("lane_count");
      const opacity = document.getElementById("lane_opacity");
      const opacityValue = document.getElementById("lane_opacity_value");
      const boundsValue = document.getElementById("lane_bounds_value");
      const toggle = document.getElementById("toggle_lane_guides");
      const reset = document.getElementById("reset_lane_grid");

      laneCount?.toggleAttribute("disabled", !image);
      opacity?.toggleAttribute("disabled", !image);
      toggle?.toggleAttribute("disabled", !image);
      reset?.toggleAttribute("disabled", !grid);

      if (grid) {
        if (laneCount) laneCount.value = String(grid.lane_count);
        if (opacity) opacity.value = String(grid.opacity);
      }
      const shownOpacity = grid ? grid.opacity : this.readLaneOpacity();
      if (opacityValue) opacityValue.textContent = `${Math.round(shownOpacity * 100)}%`;
      if (boundsValue) {
        boundsValue.textContent = grid
          ? `${Math.round(grid.left * 100)}%–${Math.round(grid.right * 100)}%`
          : "—";
      }
      if (toggle) toggle.textContent = grid?.visible ? "Hide lane guides" : "Show lane guides";
    }

    addLabelRow(position) {
      const image = this.selectedImage();
      if (!image) return;
      const before = this.beginLabelHistory();
      const grid = this.selectedGrid() || this.createLaneGrid(image, false);
      const row = this.createLabelRow(image.image_id, position, grid.lane_count);
      this.labelRows.push(row);
      this.selectedCell = { rowId: row.row_id, col: 0 };
      this.selectionAnchor = { ...this.selectedCell };
      this.ensureLabelRowsFit(image);
      this.renderLabelRows();
      this.draw();
      this.updateProperties();
      this.focusSelectedCell();
      this.commitLabelHistory(before);
    }

    createLabelRow(imageId, position, laneCount) {
      const rowNumber = this.labelRows.filter((row) => row.image_id === imageId).length + 1;
      return {
        row_id: `row_${crypto.randomUUID()}`,
        image_id: imageId,
        name: `Row ${rowNumber}`,
        position,
        height: 30,
        cells: Array.from({ length: laneCount }, () => this.defaultCell()),
      };
    }

    deleteSelectedRow() {
      const row = this.selectedRow();
      if (!row) return;
      const bounds = this.selectionBounds();
      const rowsToDelete = bounds ? bounds.rows.slice(bounds.top, bounds.bottom + 1) : [row];
      const deleteIds = new Set(rowsToDelete.map((candidate) => candidate.row_id));
      const before = this.beginLabelHistory();
      this.finishEditing(true);
      this.clearMergesForImage(row.image_id);
      this.labelRows = this.labelRows.filter((candidate) => !deleteIds.has(candidate.row_id));
      this.selectedCell = null;
      this.selectionAnchor = null;
      this.renderLabelRows();
      this.updateProperties();
      this.commitLabelHistory(before);
      this.showLabelStatus(
        deleteIds.size > 1 ? `Deleted ${deleteIds.size} rows.` : "Deleted row.",
        "success",
      );
    }

    renameSelectedRow(name) {
      const row = this.selectedRow();
      if (!row) return;
      row.name = name;
      const label = document.querySelector(`[data-label-row="${row.row_id}"] .label-row-name`);
      if (label) label.textContent = name;
      document.querySelectorAll(`.label-cell[data-row-id="${row.row_id}"]`).forEach((cell) => {
        const lane = Number(cell.dataset.column) + 1;
        cell.setAttribute("aria-label", `${name}, lane ${lane}`);
      });
      this.syncState();
    }

    positionSelectedRow(position) {
      const row = this.selectedRow();
      if (!row || !["above", "below"].includes(position)) return;
      this.clearMergesForImage(row.image_id);
      row.position = position;
      this.ensureLabelRowsFit(this.selectedImage());
      this.renderLabelRows();
      this.draw();
      this.updateProperties();
      this.focusSelectedCell();
      this.syncState();
    }

    resizeSelectedRow(value) {
      const row = this.selectedRow();
      if (!row) return;
      const parsed = Number(value);
      row.height = Math.max(20, Math.min(120, Number.isFinite(parsed) ? parsed : 30));
      const input = document.getElementById("label_row_height");
      if (input) input.value = String(row.height);
      this.ensureLabelRowsFit(this.selectedImage());
      this.renderLabelRows();
      this.draw();
      this.updateProperties();
      this.focusSelectedCell();
      this.syncState();
    }

    defaultCell() {
      return {
        text: "",
        colspan: 1,
        rowspan: 1,
        merged_into: null,
        merged_into_row: null,
        align: "center",
        vertical_align: "middle",
        font_size: 12,
        bold: false,
        italic: false,
        underline: false,
        rotation: 0,
        text_color: "#102523",
        fill_color: "#ffffff",
        border_extension: 0,
        borders: { top: true, right: true, bottom: true, left: true },
      };
    }

    selectedRow() {
      if (!this.selectedCell) return null;
      return this.labelRows.find((row) => row.row_id === this.selectedCell.rowId) || null;
    }

    resizeRowsForGrid(imageId, laneCount) {
      let changed = false;
      const rows = this.labelRows.filter((candidate) => candidate.image_id === imageId);
      if (rows.some((row) => row.cells.length !== laneCount)) {
        this.clearMergesForImage(imageId);
      }
      for (const row of rows) {
        if (row.cells.length > laneCount) {
          row.cells = row.cells.slice(0, laneCount);
          changed = true;
        }
        while (row.cells.length < laneCount) {
          row.cells.push(this.defaultCell());
          changed = true;
        }
      }
      if (this.selectedCell && this.selectedCell.col >= laneCount) {
        this.selectedCell.col = laneCount - 1;
      }
      if (this.selectionAnchor && this.selectionAnchor.col >= laneCount) {
        this.selectionAnchor.col = laneCount - 1;
      }
      if (changed) this.renderLabelRows();
    }

    adaptTemplateRows(imageId, oldLaneCount, newLaneCount) {
      const rows = this.labelRows.filter((candidate) => candidate.image_id === imageId);
      if (!rows.length || oldLaneCount === newLaneCount) return;
      const snapshots = rows.map((row) => row.cells.map((cell) => ({
        ...cell,
        borders: { ...cell.borders },
      })));
      const mergeAnchors = [];
      snapshots.forEach((cells, rowIndex) => {
        cells.forEach((cell, column) => {
          if (cell.merged_into === null && (cell.colspan > 1 || cell.rowspan > 1)) {
            mergeAnchors.push({ rowIndex, column, cell });
          }
        });
      });

      rows.forEach((row, rowIndex) => {
        const sourceCells = snapshots[rowIndex];
        const laneNumbered = sourceCells.every(
          (cell, column) => cell.merged_into === null
            && cell.colspan === 1
            && cell.rowspan === 1
            && cell.text === String(column + 1),
        );
        const repeatPeriod = laneNumbered ? null : this.repeatingCellPeriod(sourceCells);
        row.cells = Array.from({ length: newLaneCount }, (_, column) => {
          const proportional = Math.min(
            sourceCells.length - 1,
            Math.floor(column * sourceCells.length / newLaneCount),
          );
          const sourceIndex = repeatPeriod ? column % repeatPeriod : proportional;
          const source = sourceCells[sourceIndex] || this.defaultCell();
          return {
            ...source,
            text: laneNumbered ? String(column + 1) : source.text,
            colspan: 1,
            rowspan: 1,
            merged_into: null,
            merged_into_row: null,
            borders: { ...source.borders },
          };
        });
      });

      const occupied = new Set();
      for (const merge of mergeAnchors) {
        const endRow = Math.min(rows.length, merge.rowIndex + merge.cell.rowspan);
        const startColumn = Math.max(
          0,
          Math.min(newLaneCount - 1, Math.round(merge.column * newLaneCount / oldLaneCount)),
        );
        const endColumn = Math.max(
          startColumn + 1,
          Math.min(
            newLaneCount,
            Math.round((merge.column + merge.cell.colspan) * newLaneCount / oldLaneCount),
          ),
        );
        const coordinates = [];
        for (let rowIndex = merge.rowIndex; rowIndex < endRow; rowIndex += 1) {
          for (let column = startColumn; column < endColumn; column += 1) {
            coordinates.push(`${rowIndex}:${column}`);
          }
        }
        if (coordinates.some((coordinate) => occupied.has(coordinate))) continue;
        coordinates.forEach((coordinate) => occupied.add(coordinate));

        const anchorRow = rows[merge.rowIndex];
        const anchor = anchorRow.cells[startColumn];
        Object.assign(anchor, {
          ...merge.cell,
          colspan: endColumn - startColumn,
          rowspan: endRow - merge.rowIndex,
          merged_into: null,
          merged_into_row: null,
          borders: { ...merge.cell.borders },
        });
        for (let rowIndex = merge.rowIndex; rowIndex < endRow; rowIndex += 1) {
          for (let column = startColumn; column < endColumn; column += 1) {
            if (rowIndex === merge.rowIndex && column === startColumn) continue;
            const covered = rows[rowIndex].cells[column];
            covered.merged_into = startColumn;
            covered.merged_into_row = anchorRow.row_id;
          }
        }
      }

      if (this.selectedCell) {
        this.selectedCell.col = Math.min(this.selectedCell.col, newLaneCount - 1);
      }
      if (this.selectionAnchor) {
        this.selectionAnchor.col = Math.min(this.selectionAnchor.col, newLaneCount - 1);
      }
      this.renderLabelRows();
      this.showLabelStatus(
        `Template adapted from ${oldLaneCount} to ${newLaneCount} lanes.`,
        "success",
      );
    }

    repeatingCellPeriod(cells) {
      if (cells.some((cell) => cell.merged_into !== null || cell.colspan !== 1 || cell.rowspan !== 1)) {
        return null;
      }
      const signatures = cells.map((cell) => JSON.stringify({
        text: cell.text,
        align: cell.align,
        vertical_align: cell.vertical_align,
        font_size: cell.font_size,
        bold: cell.bold,
        italic: cell.italic,
        underline: cell.underline,
        rotation: cell.rotation,
        text_color: cell.text_color,
        fill_color: cell.fill_color,
        border_extension: cell.border_extension,
        borders: cell.borders,
      }));
      for (let period = 1; period <= Math.floor(cells.length / 2); period += 1) {
        if (signatures.every((signature, index) => signature === signatures[index % period])) {
          return period;
        }
      }
      return null;
    }

    renderLabelRows() {
      const overlay = document.getElementById("label_grid_overlay");
      if (!overlay) return;
      overlay.replaceChildren();

      for (const row of this.labelRows) {
        const rowElement = document.createElement("div");
        rowElement.className = "label-row";
        rowElement.dataset.labelRow = row.row_id;
        rowElement.setAttribute("role", "row");
        rowElement.style.setProperty("--lane-count", String(row.cells.length));
        rowElement.style.height = `${row.height}px`;

        const nameElement = document.createElement("div");
        nameElement.className = "label-row-name";
        nameElement.textContent = row.name;
        nameElement.title = row.name;
        rowElement.append(nameElement);

        row.cells.forEach((cell, column) => {
          if (cell.merged_into !== null || cell.rowspan > 1) return;
          const cellElement = this.createCellElement(row, cell, column);
          cellElement.style.gridColumn = `${column + 1} / span ${cell.colspan}`;
          rowElement.append(cellElement);
        });
        overlay.append(rowElement);
      }
      this.positionLabelRows();
      this.updateCellSelection();
    }

    createCellElement(row, cell, column) {
      const cellElement = document.createElement("div");
      cellElement.className = "label-cell";
      cellElement.dataset.rowId = row.row_id;
      cellElement.dataset.column = String(column);
      cellElement.dataset.colspan = String(cell.colspan);
      cellElement.dataset.rowspan = String(cell.rowspan || 1);
      cellElement.contentEditable = "false";
      cellElement.tabIndex = 0;
      cellElement.setAttribute("role", "gridcell");
      const laneDescription = cell.colspan > 1
        ? `lanes ${column + 1} through ${column + cell.colspan}`
        : `lane ${column + 1}`;
      const rowDescription = cell.rowspan > 1 ? `, spanning ${cell.rowspan} rows` : "";
      cellElement.setAttribute("aria-label", `${row.name}, ${laneDescription}${rowDescription}`);
      cellElement.textContent = cell.text;
      this.applyCellElementStyle(cellElement, cell, row, column);
      return cellElement;
    }

    applyCellElementStyle(element, cell, row, column) {
      const justify = { left: "flex-start", center: "center", right: "flex-end" };
      const vertical = { top: "flex-start", middle: "center", bottom: "flex-end" };
      element.style.justifyContent = justify[cell.align] || "center";
      element.style.alignItems = vertical[cell.vertical_align] || "center";
      element.style.fontSize = `${cell.font_size}px`;
      element.style.fontWeight = cell.bold ? "700" : "400";
      element.style.fontStyle = cell.italic ? "italic" : "normal";
      element.style.textDecoration = cell.underline ? "underline" : "none";
      element.style.writingMode = cell.rotation === 0 ? "horizontal-tb" : "vertical-rl";
      element.style.textOrientation = "mixed";
      element.style.transform = cell.rotation === -90 ? "rotate(180deg)" : "none";
      element.style.transformOrigin = "center";
      element.style.color = cell.text_color || "#102523";
      element.style.backgroundColor = cell.fill_color || "#ffffff";
      const visibleBorders = {
        top: cell.borders.top,
        right: row.cells[column + cell.colspan - 1].borders.right,
        bottom: cell.borders.bottom,
        left: cell.borders.left,
      };
      for (const side of ["top", "right", "bottom", "left"]) {
        element.style[`border${side[0].toUpperCase()}${side.slice(1)}`] = visibleBorders[side]
          ? "1px solid #94a7a4"
          : "0 solid transparent";
      }
    }

    positionLabelRows() {
      for (const image of this.surfaces()) {
        const grid = this.laneGrids.get(image.image_id);
        if (!grid) continue;
        const left = image.x + image.width * grid.left;
        const width = image.width * (grid.right - grid.left);
        const above = this.labelRows.filter((row) => row.image_id === image.image_id && row.position === "above");
        const below = this.labelRows.filter((row) => row.image_id === image.image_id && row.position === "below");

        let aboveOffset = 6;
        for (const row of above) {
          const element = document.querySelector(`[data-label-row="${row.row_id}"]`);
          if (!element) continue;
          aboveOffset += row.height;
          element.style.left = `${left}px`;
          element.style.top = `${image.y - aboveOffset}px`;
          element.style.width = `${width}px`;
        }

        let belowOffset = 6;
        for (const row of below) {
          const element = document.querySelector(`[data-label-row="${row.row_id}"]`);
          if (!element) continue;
          element.style.left = `${left}px`;
          element.style.top = `${image.y + image.height + belowOffset}px`;
          element.style.width = `${width}px`;
          belowOffset += row.height;
        }
      }
      this.renderVerticalMergedCells();
      this.renderBorderExtensions();
    }

    renderVerticalMergedCells() {
      const overlay = document.getElementById("label_grid_overlay");
      if (!overlay) return;
      const expectedCells = new Set();
      overlay.querySelectorAll(".label-row.has-vertical-merge").forEach(
        (row) => row.classList.remove("has-vertical-merge"),
      );
      for (const image of this.surfaces()) {
        const grid = this.laneGrids.get(image.image_id);
        if (!grid) continue;
        const rows = this.labelRows.filter((row) => row.image_id === image.image_id);
        rows.forEach((row, rowIndex) => {
          row.cells.forEach((cell, column) => {
            if (cell.merged_into !== null || Number(cell.rowspan || 1) <= 1) return;
            const spannedRows = rows.slice(rowIndex, rowIndex + cell.rowspan);
            const rowElements = spannedRows
              .map((candidate) => overlay.querySelector(`[data-label-row="${candidate.row_id}"]`))
              .filter(Boolean);
            if (rowElements.length !== cell.rowspan) return;
            const anchorRowElement = rowElements[0];
            const tops = rowElements.map((element) => Number.parseFloat(element.style.top || "0"));
            const bottoms = rowElements.map(
              (element, index) => tops[index] + spannedRows[index].height,
            );
            const width = image.width * (grid.right - grid.left);
            const cellKey = `${row.row_id}:${column}`;
            expectedCells.add(cellKey);
            let cellElement = overlay.querySelector(
              `.vertical-merged-cell[data-row-id="${row.row_id}"][data-column="${column}"]`,
            );
            if (!cellElement) {
              cellElement = this.createCellElement(row, cell, column);
              cellElement.classList.add("vertical-merged-cell");
            } else if (cellElement.contentEditable !== "true") {
              cellElement.textContent = cell.text;
              this.applyCellElementStyle(cellElement, cell, row, column);
            }
            cellElement.style.left = `${width * column / row.cells.length}px`;
            cellElement.style.top = `${Math.min(...tops) - tops[0]}px`;
            cellElement.style.width = `${width * cell.colspan / row.cells.length}px`;
            cellElement.style.height = `${Math.max(...bottoms) - Math.min(...tops)}px`;
            anchorRowElement.classList.add("has-vertical-merge");
            if (cellElement.parentElement !== anchorRowElement) {
              anchorRowElement.append(cellElement);
            }
          });
        });
      }
      overlay.querySelectorAll(".vertical-merged-cell").forEach((cellElement) => {
        const key = `${cellElement.dataset.rowId}:${cellElement.dataset.column}`;
        if (!expectedCells.has(key)) cellElement.remove();
      });
    }

    renderBorderExtensions() {
      const overlay = document.getElementById("label_grid_overlay");
      if (!overlay) return;
      overlay.querySelectorAll(".border-extension-line").forEach((line) => line.remove());
      for (const row of this.labelRows) {
        const image = this.surfaces().find((candidate) => candidate.image_id === row.image_id);
        const grid = image ? this.laneGrids.get(image.image_id) : null;
        const rowElement = overlay.querySelector(`[data-label-row="${row.row_id}"]`);
        if (!image || !grid || !rowElement) continue;
        const rowTop = Number.parseFloat(rowElement.style.top || "0");
        const left = image.x + image.width * grid.left;
        const width = image.width * (grid.right - grid.left);
        row.cells.forEach((cell, column) => {
          if (cell.merged_into !== null || Number(cell.border_extension || 0) <= 0) return;
          const extension = Math.min(500, Number(cell.border_extension));
          const rightCell = row.cells[column + cell.colspan - 1];
          const edges = [];
          if (cell.borders.left) edges.push(column);
          if (rightCell.borders.right) edges.push(column + cell.colspan);
          for (const edge of new Set(edges)) {
            const line = document.createElement("div");
            line.className = "border-extension-line";
            line.dataset.rowId = row.row_id;
            line.dataset.columnEdge = String(edge);
            line.style.left = `${left + width * edge / row.cells.length}px`;
            let blockTop = rowTop;
            let blockBottom = rowTop + row.height;
            if (cell.rowspan > 1) {
              const rows = this.labelRows.filter((candidate) => candidate.image_id === row.image_id);
              const rowIndex = rows.findIndex((candidate) => candidate.row_id === row.row_id);
              const elements = rows.slice(rowIndex, rowIndex + cell.rowspan)
                .map((candidate) => overlay.querySelector(`[data-label-row="${candidate.row_id}"]`))
                .filter(Boolean);
              if (elements.length === cell.rowspan) {
                const tops = elements.map((element) => Number.parseFloat(element.style.top || "0"));
                blockTop = Math.min(...tops);
                blockBottom = Math.max(
                  ...elements.map((element, index) => tops[index] + rows[rowIndex + index].height),
                );
              }
            }
            line.style.top = `${row.position === "above" ? blockBottom : blockTop - extension}px`;
            line.style.height = `${extension}px`;
            overlay.append(line);
          }
        });
      }
    }

    ensureLabelRowsFit(image) {
      if (!image) return;
      const rows = this.labelRows.filter((row) => row.image_id === image.image_id);
      const aboveRows = rows.filter((row) => row.position === "above");
      const belowRows = rows.filter((row) => row.position === "below");
      const aboveHeight = aboveRows.reduce((total, row) => total + row.height, 0) + (aboveRows.length ? 6 : 0);
      const belowHeight = belowRows.reduce((total, row) => total + row.height, 0) + (belowRows.length ? 6 : 0);
      const availableHeight = Math.max(MIN_IMAGE_SIZE, this.stageHeight - aboveHeight - belowHeight - 16);
      if (image.height > availableHeight) {
        const scale = availableHeight / image.height;
        image.height = Math.round(image.height * scale);
        image.width = Math.round(image.width * scale);
      }
      const minimumY = 8 + aboveHeight;
      const maximumY = Math.max(minimumY, this.stageHeight - 8 - belowHeight - image.height);
      image.y = Math.round(Math.max(minimumY, Math.min(maximumY, image.y)));
    }

    handleCellPointerDown(event) {
      const cell = event.target.closest(".label-cell");
      if (!cell) return;
      if (cell.contentEditable === "true") return;
      event.preventDefault();
      event.stopPropagation();
      this.finishEditing(true);
      this.selectCell(cell.dataset.rowId, Number(cell.dataset.column), true, event.shiftKey);
      this.draggingSelection = true;
    }

    handleCellDoubleClick(event) {
      const cell = event.target.closest(".label-cell");
      if (!cell) return;
      event.preventDefault();
      event.stopPropagation();
      this.draggingSelection = false;
      this.beginCellEdit(cell.dataset.rowId, Number(cell.dataset.column));
    }

    handleCellPointerOver(event) {
      if (!this.draggingSelection) return;
      const cell = event.target.closest(".label-cell");
      if (!cell) return;
      event.preventDefault();
      this.selectCell(cell.dataset.rowId, Number(cell.dataset.column), false, true);
    }

    handleCellKeyDown(event) {
      const cell = event.target.closest(".label-cell");
      if (!cell) return;
      const rowId = cell.dataset.rowId;
      const column = Number(cell.dataset.column);
      const editing = cell.contentEditable === "true";
      const commandKey = event.ctrlKey || event.metaKey;

      if (commandKey && event.shiftKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        event.stopPropagation();
        this.finishEditing(true);
        this.selectCell(rowId, column, false);
        this.armPasteHorizontal();
        return;
      }

      if (editing) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.finishEditing(false);
          return;
        }
        if (event.key === "Tab" || event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          this.finishEditing(true);
          this.moveCellSelection(event.key === "Tab" ? (event.shiftKey ? -1 : 1) : 0, event.key === "Enter" ? 1 : 0);
          return;
        }
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
          const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
          this.finishEditing(true);
          this.moveCellSelection(horizontal, vertical, event.shiftKey);
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        this.beginCellEdit(rowId, column);
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        this.moveCellSelection(event.shiftKey ? -1 : 1, 0);
      } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
        const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        this.moveCellSelection(horizontal, vertical, event.shiftKey);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        this.clearSelectedCells();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        this.beginCellEdit(rowId, column, event.key);
      }
    }

    handleCellInput(event) {
      const cell = event.target.closest('.label-cell[contenteditable="true"]');
      if (!cell) return;
      const row = this.labelRows.find((candidate) => candidate.row_id === cell.dataset.rowId);
      const column = Number(cell.dataset.column);
      if (row?.cells[column]) {
        row.cells[column].text = cell.textContent.replace(/[\r\n]+/g, " ");
        this.syncState();
      }
    }

    handleCellBlur(event) {
      const cell = event.target.closest('.label-cell[contenteditable="true"]');
      if (cell && this.editingCell) this.finishEditing(true);
    }

    handleCellPaste(event) {
      const cell = event.target.closest(".label-cell");
      const text = event.clipboardData?.getData("text/plain");
      if (!cell || text === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      this.finishEditing(true);
      this.selectCell(cell.dataset.rowId, Number(cell.dataset.column), false);
      if (this.pasteHorizontalPending) {
        this.pasteHorizontalPending = false;
        this.pasteHorizontal(text);
      } else {
        this.pasteTabularText(text);
      }
    }

    armPasteHorizontal() {
      this.pasteHorizontalPending = true;
      window.clearTimeout(this.pasteHorizontalPendingTimeout);
      this.pasteHorizontalPendingTimeout = window.setTimeout(() => {
        this.pasteHorizontalPending = false;
      }, 1000);
    }

    pasteTabularText(text) {
      if (!this.selectedCell) return;
      const normalized = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = normalized.split("\n");
      while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      const matrix = lines.map((line) => line.split("\t").map((value) => value.replace(/[\r\n]+/g, " ")));
      const width = Math.max(...matrix.map((line) => line.length));
      const imageRows = this.labelRows.filter((row) => row.image_id === this.selectedId);
      const startRowIndex = imageRows.findIndex((row) => row.row_id === this.selectedCell.rowId);
      const startColumn = this.selectedCell.col;
      if (startRowIndex < 0 || width < 1) return;
      if (startColumn + width > imageRows[startRowIndex].cells.length) {
        this.showLabelStatus(
          `Paste needs ${width} columns, but only ${imageRows[startRowIndex].cells.length - startColumn} lanes remain.`,
          "error",
        );
        this.focusSelectedCell();
        return;
      }

      for (let rowOffset = 0; rowOffset < matrix.length; rowOffset += 1) {
        const row = imageRows[startRowIndex + rowOffset];
        if (!row) continue;
        for (let columnOffset = 0; columnOffset < matrix[rowOffset].length; columnOffset += 1) {
          const cell = row.cells[startColumn + columnOffset];
          if (cell.merged_into !== null || cell.colspan !== 1) {
            this.showLabelStatus("Unmerge the destination cells before pasting tabular data.", "error");
            this.focusSelectedCell();
            return;
          }
        }
      }

      const before = this.beginLabelHistory();
      const startRow = imageRows[startRowIndex];
      while (imageRows.length < startRowIndex + matrix.length) {
        const newRow = this.createLabelRow(this.selectedId, startRow.position, startRow.cells.length);
        this.labelRows.push(newRow);
        imageRows.push(newRow);
      }
      let populated = 0;
      matrix.forEach((values, rowOffset) => {
        const row = imageRows[startRowIndex + rowOffset];
        values.forEach((value, columnOffset) => {
          row.cells[startColumn + columnOffset].text = value;
          populated += 1;
        });
      });
      this.selectionAnchor = { rowId: startRow.row_id, col: startColumn };
      const lastRow = imageRows[startRowIndex + matrix.length - 1];
      this.selectedCell = { rowId: lastRow.row_id, col: startColumn + width - 1 };
      this.ensureLabelRowsFit(this.selectedImage());
      this.renderLabelRows();
      this.draw();
      this.updateProperties();
      this.focusSelectedCell();
      this.commitLabelHistory(before);
      this.showLabelStatus(
        `Pasted ${populated} cell${populated === 1 ? "" : "s"} across ${matrix.length} row${matrix.length === 1 ? "" : "s"}.`,
        "success",
      );
    }

    pasteHorizontal(text) {
      if (!this.selectedCell || text === undefined || text === null) return;
      const normalized = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = normalized.split("\n");
      while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      const values = lines.flatMap((line) => line.split("\t").map((value) => value.replace(/[\r\n]+/g, " ")));
      if (!values.length) return;

      const rows = this.labelRows.filter((row) => row.image_id === this.selectedId);
      const rowIndex = rows.findIndex((row) => row.row_id === this.selectedCell.rowId);
      const startColumn = this.selectedCell.col;
      if (rowIndex < 0) return;
      const row = rows[rowIndex];

      if (startColumn + values.length > row.cells.length) {
        this.showLabelStatus(
          `Paste horizontal needs ${values.length} lanes, but only ${row.cells.length - startColumn} remain.`,
          "error",
        );
        this.focusSelectedCell();
        return;
      }
      for (let index = 0; index < values.length; index += 1) {
        const cell = row.cells[startColumn + index];
        if (cell.merged_into !== null || cell.colspan !== 1) {
          this.showLabelStatus("Unmerge the destination cells before pasting horizontally.", "error");
          this.focusSelectedCell();
          return;
        }
      }

      const before = this.beginLabelHistory();
      values.forEach((value, index) => { row.cells[startColumn + index].text = value; });
      this.selectionAnchor = { rowId: row.row_id, col: startColumn };
      this.selectedCell = { rowId: row.row_id, col: startColumn + values.length - 1 };
      this.renderLabelRows();
      this.draw();
      this.updateProperties();
      this.focusSelectedCell();
      this.commitLabelHistory(before);
      this.showLabelStatus(
        `Pasted ${values.length} value${values.length === 1 ? "" : "s"} across the row.`,
        "success",
      );
    }

    fillLaneNumbers() {
      const row = this.selectedRow();
      if (!row) return;
      if (row.cells.some((cell) => cell.merged_into !== null || cell.colspan !== 1)) {
        this.showLabelStatus("Unmerge this row before filling lane numbers.", "error");
        return;
      }
      const before = this.beginLabelHistory();
      row.cells.forEach((cell, column) => { cell.text = String(column + 1); });
      this.selectionAnchor = { rowId: row.row_id, col: 0 };
      this.selectedCell = { rowId: row.row_id, col: row.cells.length - 1 };
      this.renderLabelRows();
      this.updateProperties();
      this.focusSelectedCell();
      this.commitLabelHistory(before);
      this.showLabelStatus(`Filled lane numbers 1–${row.cells.length}.`, "success");
    }

    repeatSelectedPattern() {
      const bounds = this.selectionBounds();
      if (!bounds || bounds.top !== bounds.bottom) {
        this.showLabelStatus("Select a pattern within one row before repeating it.", "error");
        return;
      }
      const row = bounds.rows[bounds.top];
      if (row.cells.some((cell) => cell.merged_into !== null || cell.colspan !== 1)) {
        this.showLabelStatus("Unmerge this row before repeating a pattern.", "error");
        return;
      }
      const pattern = row.cells.slice(bounds.left, bounds.right + 1).map((cell) => cell.text);
      if (!pattern.some((value) => value !== "")) {
        this.showLabelStatus("Enter at least one pattern value before repeating it.", "error");
        return;
      }
      const before = this.beginLabelHistory();
      row.cells.forEach((cell, column) => { cell.text = pattern[column % pattern.length]; });
      this.selectionAnchor = { rowId: row.row_id, col: 0 };
      this.selectedCell = { rowId: row.row_id, col: row.cells.length - 1 };
      this.renderLabelRows();
      this.updateProperties();
      this.focusSelectedCell();
      this.commitLabelHistory(before);
      this.showLabelStatus(`Repeated a ${pattern.length}-cell pattern across ${row.cells.length} lanes.`, "success");
    }

    showLabelStatus(message, type = "") {
      const status = document.getElementById("label_action_status");
      if (!status) return;
      status.textContent = message;
      status.classList.toggle("is-success", type === "success");
      status.classList.toggle("is-error", type === "error");
    }

    selectCell(rowId, column, focus = true, extend = false) {
      const resolved = this.resolveCellAnchor(rowId, column);
      if (!resolved) return;
      const { row } = resolved;
      rowId = row.row_id;
      column = resolved.column;
      this.selectedId = row.image_id;
      this.selectedCell = { rowId, col: column };
      if (!extend || !this.selectionAnchor) this.selectionAnchor = { ...this.selectedCell };
      this.draw();
      this.updateProperties();
      this.updateCellSelection();
      if (focus) this.focusSelectedCell();
    }

    resolveCellAnchor(rowId, column) {
      const row = this.labelRows.find((candidate) => candidate.row_id === rowId);
      const cell = row?.cells[column];
      if (!row || !cell) return null;
      if (cell.merged_into === null) return { row, column, cell };
      const anchorRow = this.labelRows.find(
        (candidate) => candidate.row_id === (cell.merged_into_row || row.row_id),
      );
      const anchor = anchorRow?.cells[cell.merged_into];
      if (!anchorRow || !anchor) return null;
      return { row: anchorRow, column: cell.merged_into, cell: anchor };
    }

    beginCellEdit(rowId, column, initialText = null) {
      const resolved = this.resolveCellAnchor(rowId, column);
      if (!resolved) return;
      rowId = resolved.row.row_id;
      column = resolved.column;
      const historyBefore = this.beginLabelHistory();
      this.selectCell(rowId, column, false);
      const cell = this.cellElement(rowId, column);
      const row = resolved.row;
      if (!cell || !row) return;
      this.editingCell = { rowId, col: column, original: row.cells[column].text, historyBefore };
      if (initialText !== null) {
        row.cells[column].text = initialText;
        cell.textContent = initialText;
      }
      cell.contentEditable = "true";
      cell.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection?.selectAllChildren(cell);
      selection?.collapseToEnd();
    }

    finishEditing(commit) {
      if (!this.editingCell) return;
      const { rowId, col, original, historyBefore } = this.editingCell;
      const row = this.labelRows.find((candidate) => candidate.row_id === rowId);
      const cell = this.cellElement(rowId, col);
      if (row?.cells[col] && cell) {
        row.cells[col].text = commit ? cell.textContent.replace(/[\r\n]+/g, " ") : original;
        cell.textContent = row.cells[col].text;
        cell.contentEditable = "false";
      }
      this.editingCell = null;
      this.updateCellSelection();
      if (commit && historyBefore) this.commitLabelHistory(historyBefore);
    }

    moveCellSelection(horizontal, vertical, extend = false) {
      if (!this.selectedCell) return;
      const rows = this.labelRows.filter((row) => row.image_id === this.selectedId);
      const rowIndex = rows.findIndex((row) => row.row_id === this.selectedCell.rowId);
      if (rowIndex < 0) return;
      const currentCell = rows[rowIndex].cells[this.selectedCell.col];
      let nextRow = rowIndex + (vertical > 0 ? currentCell.rowspan || 1 : vertical);
      let nextColumn = this.selectedCell.col + (horizontal > 0 ? currentCell.colspan : horizontal);

      if (horizontal !== 0) {
        if (nextColumn >= rows[rowIndex].cells.length) {
          nextRow = Math.min(rows.length - 1, rowIndex + 1);
          nextColumn = nextRow === rowIndex ? rows[rowIndex].cells.length - 1 : 0;
        } else if (nextColumn < 0) {
          nextRow = Math.max(0, rowIndex - 1);
          nextColumn = nextRow === rowIndex ? 0 : rows[nextRow].cells.length - 1;
        }
      }
      nextRow = Math.max(0, Math.min(rows.length - 1, nextRow));
      nextColumn = Math.max(0, Math.min(rows[nextRow].cells.length - 1, nextColumn));
      const resolved = this.resolveCellAnchor(rows[nextRow].row_id, nextColumn);
      if (resolved) this.selectCell(resolved.row.row_id, resolved.column, true, extend);
    }

    cellElement(rowId, column) {
      return document.querySelector(`.label-cell[data-row-id="${rowId}"][data-column="${column}"]`);
    }

    focusSelectedCell() {
      if (!this.selectedCell) return;
      this.cellElement(this.selectedCell.rowId, this.selectedCell.col)?.focus({ preventScroll: true });
    }

    updateCellSelection() {
      document.querySelectorAll(".label-cell").forEach((cell) => {
        const selected = this.selectionIncludes(
          cell.dataset.rowId,
          Number(cell.dataset.column),
          Number(cell.dataset.colspan || 1),
          Number(cell.dataset.rowspan || 1),
        );
        cell.classList.toggle("is-selected", selected);
        cell.setAttribute("aria-selected", String(selected));
      });
    }

    selectionBounds() {
      if (!this.selectionAnchor || !this.selectedCell) return null;
      const rows = this.labelRows.filter((row) => row.image_id === this.selectedId);
      const anchorRow = rows.findIndex((row) => row.row_id === this.selectionAnchor.rowId);
      const focusRow = rows.findIndex((row) => row.row_id === this.selectedCell.rowId);
      if (anchorRow < 0 || focusRow < 0) return null;
      const anchorCell = rows[anchorRow].cells[this.selectionAnchor.col];
      const focusCell = rows[focusRow].cells[this.selectedCell.col];
      const anchorSpan = anchorCell?.colspan || 1;
      const focusSpan = focusCell?.colspan || 1;
      let top = Math.min(anchorRow, focusRow);
      let bottom = Math.max(
        anchorRow + (anchorCell?.rowspan || 1) - 1,
        focusRow + (focusCell?.rowspan || 1) - 1,
      );
      let left = Math.min(this.selectionAnchor.col, this.selectedCell.col);
      let right = Math.max(
        this.selectionAnchor.col + anchorSpan - 1,
        this.selectedCell.col + focusSpan - 1,
      );
      let expanded = true;
      while (expanded) {
        expanded = false;
        rows.forEach((row, rowIndex) => {
          row.cells.forEach((cell, column) => {
            if (cell.merged_into !== null || (cell.colspan <= 1 && cell.rowspan <= 1)) return;
            const cellBottom = rowIndex + cell.rowspan - 1;
            const end = column + cell.colspan - 1;
            const intersects = cellBottom >= top && rowIndex <= bottom && end >= left && column <= right;
            if (intersects && (rowIndex < top || cellBottom > bottom || column < left || end > right)) {
              top = Math.min(top, rowIndex);
              bottom = Math.max(bottom, cellBottom);
              left = Math.min(left, column);
              right = Math.max(right, end);
              expanded = true;
            }
          });
        });
      }
      return {
        rows,
        top,
        bottom,
        left,
        right,
      };
    }

    selectionIncludes(rowId, column, colspan = 1, rowspan = 1) {
      const bounds = this.selectionBounds();
      if (!bounds) return false;
      const rowIndex = bounds.rows.findIndex((row) => row.row_id === rowId);
      const end = column + colspan - 1;
      const rowEnd = rowIndex + rowspan - 1;
      return rowEnd >= bounds.top && rowIndex <= bounds.bottom && end >= bounds.left && column <= bounds.right;
    }

    selectedCellEntries() {
      const bounds = this.selectionBounds();
      if (!bounds) return [];
      const entries = [];
      for (let rowIndex = bounds.top; rowIndex <= bounds.bottom; rowIndex += 1) {
        const row = bounds.rows[rowIndex];
        for (let column = bounds.left; column <= bounds.right; column += 1) {
          if (row.cells[column]) entries.push({ row, rowIndex, column, cell: row.cells[column] });
        }
      }
      return entries;
    }

    clearSelectedCells() {
      const entries = this.selectedCellEntries();
      if (!entries.length) return;
      const before = this.beginLabelHistory();
      for (const { cell } of entries) {
        if (cell.merged_into === null) cell.text = "";
      }
      this.renderLabelRows();
      this.focusSelectedCell();
      this.commitLabelHistory(before);
    }

    clearMergesForImage(imageId) {
      for (const row of this.labelRows.filter((candidate) => candidate.image_id === imageId)) {
        for (const cell of row.cells) {
          cell.colspan = 1;
          cell.rowspan = 1;
          cell.merged_into = null;
          cell.merged_into_row = null;
        }
      }
    }

    selectedMergeAnchors() {
      const anchors = new Map();
      for (const { row, column, cell } of this.selectedCellEntries()) {
        const resolved = this.resolveCellAnchor(row.row_id, column);
        if (!resolved) continue;
        const { row: anchorRow, column: anchorColumn, cell: anchor } = resolved;
        if (anchor.colspan > 1 || anchor.rowspan > 1) {
          anchors.set(
            `${anchorRow.row_id}:${anchorColumn}`,
            { row: anchorRow, column: anchorColumn, cell: anchor },
          );
        }
      }
      return Array.from(anchors.values());
    }

    canMergeSelection() {
      const bounds = this.selectionBounds();
      if (!bounds || (bounds.top === bounds.bottom && bounds.left === bounds.right)) return false;
      const rows = bounds.rows.slice(bounds.top, bounds.bottom + 1);
      if (!rows.length || rows.some((row) => row.position !== rows[0].position)) return false;
      for (const row of rows) {
        for (let column = bounds.left; column <= bounds.right; column += 1) {
          const cell = row.cells[column];
          if (!cell || cell.merged_into !== null || cell.colspan !== 1 || cell.rowspan !== 1) return false;
        }
      }
      return true;
    }

    toggleMergeSelected() {
      this.finishEditing(true);
      const existing = this.selectedMergeAnchors();
      if (existing.length) {
        for (const { row, column, cell } of existing) {
          const rows = this.labelRows.filter((candidate) => candidate.image_id === row.image_id);
          const rowIndex = rows.findIndex((candidate) => candidate.row_id === row.row_id);
          const endRow = Math.min(rows.length, rowIndex + cell.rowspan);
          const endColumn = Math.min(row.cells.length, column + cell.colspan);
          for (let coveredRow = rowIndex; coveredRow < endRow; coveredRow += 1) {
            for (let coveredColumn = column; coveredColumn < endColumn; coveredColumn += 1) {
              const covered = rows[coveredRow].cells[coveredColumn];
              covered.colspan = 1;
              covered.rowspan = 1;
              covered.merged_into = null;
              covered.merged_into_row = null;
            }
          }
          cell.colspan = 1;
          cell.rowspan = 1;
        }
      } else if (this.canMergeSelection()) {
        const bounds = this.selectionBounds();
        const row = bounds.rows[bounds.top];
        const anchor = row.cells[bounds.left];
        anchor.colspan = bounds.right - bounds.left + 1;
        anchor.rowspan = bounds.bottom - bounds.top + 1;
        for (let rowIndex = bounds.top; rowIndex <= bounds.bottom; rowIndex += 1) {
          for (let column = bounds.left; column <= bounds.right; column += 1) {
            if (rowIndex === bounds.top && column === bounds.left) continue;
            const covered = bounds.rows[rowIndex].cells[column];
            covered.merged_into = bounds.left;
            covered.merged_into_row = row.row_id;
          }
        }
        this.selectedCell = { rowId: row.row_id, col: bounds.left };
        this.selectionAnchor = { ...this.selectedCell };
      } else {
        return;
      }
      this.renderLabelRows();
      this.updateProperties();
      this.focusSelectedCell();
      this.syncState();
    }

    applyCellProperty(property, value) {
      const entries = this.selectedCellEntries();
      if (!entries.length) return;
      for (const { cell } of entries) cell[property] = value;
      this.renderLabelRows();
      this.updateProperties();
      this.focusSelectedCell();
      this.syncState();
    }

    toggleCellProperty(property) {
      const entries = this.selectedCellEntries();
      if (!entries.length) return;
      const value = !entries.every(({ cell }) => Boolean(cell[property]));
      this.applyCellProperty(property, value);
    }

    cycleSelectedRotation() {
      if (!this.selectedCell) return;
      const row = this.selectedRow();
      const current = row?.cells[this.selectedCell.col]?.rotation ?? 0;
      const next = current === 0 ? 90 : current === 90 ? -90 : 0;
      this.applyCellProperty("rotation", next);
    }

    applyBorderPreset(preset) {
      const entries = this.selectedCellEntries();
      const bounds = this.selectionBounds();
      if (!entries.length || !bounds || preset === "custom") return;
      for (const entry of entries) {
        entry.cell.borders = { top: false, right: false, bottom: false, left: false };
        if (preset === "all") {
          entry.cell.borders = { top: true, right: true, bottom: true, left: true };
        } else if (preset === "outer") {
          entry.cell.borders.top = entry.rowIndex === bounds.top;
          entry.cell.borders.bottom = entry.rowIndex === bounds.bottom;
          entry.cell.borders.left = entry.column === bounds.left;
          entry.cell.borders.right = entry.column === bounds.right;
        } else if (preset === "top") {
          entry.cell.borders.top = entry.rowIndex === bounds.top;
        } else if (preset === "bottom") {
          entry.cell.borders.bottom = entry.rowIndex === bounds.bottom;
        } else if (preset === "left") {
          entry.cell.borders.left = entry.column === bounds.left;
        } else if (preset === "right") {
          entry.cell.borders.right = entry.column === bounds.right;
        }
      }
      this.renderLabelRows();
      this.updateProperties();
      this.focusSelectedCell();
      this.syncState();
    }

    updateFormattingControls() {
      const entries = this.selectedCellEntries();
      const active = entries.length > 0;
      const focused = this.selectedRow()?.cells[this.selectedCell?.col] || null;
      for (const id of ["align_left", "align_center", "align_right", "cell_bold", "cell_italic", "cell_underline", "cell_font_size", "cell_rotation", "cell_text_color", "cell_fill_color", "reset_cell_colors", "cell_border_preset", "cell_border_extension", "cell_borders", "rotate_object"]) {
        document.getElementById(id)?.toggleAttribute("disabled", !active);
      }
      const merge = document.getElementById("merge_cells");
      const merged = this.selectedMergeAnchors().length > 0;
      merge?.toggleAttribute("disabled", !(merged || this.canMergeSelection()));
      if (merge) {
        const label = merge.querySelector("span:last-child");
        if (label) label.textContent = merged ? "Unmerge" : "Merge";
        merge.title = merged ? "Unmerge selected cells" : "Merge selected cells";
      }
      for (const [id, alignment] of [["align_left", "left"], ["align_center", "center"], ["align_right", "right"]]) {
        document.getElementById(id)?.classList.toggle("is-active", focused?.align === alignment);
      }
      for (const [id, property] of [["cell_bold", "bold"], ["cell_italic", "italic"], ["cell_underline", "underline"]]) {
        document.getElementById(id)?.classList.toggle("is-active", Boolean(focused?.[property]));
      }
      const fontSize = document.getElementById("cell_font_size");
      const rotation = document.getElementById("cell_rotation");
      const textColor = document.getElementById("cell_text_color");
      const fillColor = document.getElementById("cell_fill_color");
      const borders = document.getElementById("cell_border_preset");
      const borderExtension = document.getElementById("cell_border_extension");
      if (fontSize && focused) fontSize.value = String(focused.font_size);
      if (rotation && focused) rotation.value = String(focused.rotation);
      if (textColor && focused) textColor.value = focused.text_color || "#102523";
      if (fillColor && focused) fillColor.value = focused.fill_color || "#ffffff";
      if (borderExtension && focused) {
        borderExtension.value = String(focused.border_extension || 0);
      }
      if (borders && active) {
        const everyAll = entries.every(({ cell }) => Object.values(cell.borders).every(Boolean));
        const everyNone = entries.every(({ cell }) => Object.values(cell.borders).every((value) => !value));
        borders.value = everyAll ? "all" : everyNone ? "none" : "custom";
      }
    }

    updateProductivityControls() {
      const row = this.selectedRow();
      const bounds = this.selectionBounds();
      document.getElementById("fill_lane_numbers")?.toggleAttribute("disabled", !row);
      document.getElementById("repeat_pattern")?.toggleAttribute(
        "disabled",
        !(row && bounds && bounds.top === bounds.bottom),
      );
      if (!row) this.showLabelStatus("Select a cell to use labeling helpers.");
    }

    updateRowControls(image) {
      const row = this.selectedRow();
      const activeRow = row && image && row.image_id === image.image_id ? row : null;
      for (const id of ["add_row_above", "add_row_below"]) {
        document.getElementById(id)?.toggleAttribute("disabled", !image);
      }
      const name = document.getElementById("label_row_name");
      const position = document.getElementById("label_row_position");
      const height = document.getElementById("label_row_height");
      const deleteButton = document.getElementById("delete_label_row");
      name?.toggleAttribute("disabled", !activeRow);
      position?.toggleAttribute("disabled", !activeRow);
      height?.toggleAttribute("disabled", !activeRow);
      deleteButton?.toggleAttribute("disabled", !activeRow);
      if (name) name.value = activeRow?.name || "";
      if (position && activeRow) position.value = activeRow.position;
      if (height && activeRow) height.value = String(activeRow.height);
    }

    state() {
      return {
        schema_version: SCHEMA_VERSION,
        canvas: { width: this.stageWidth, height: this.stageHeight },
        images: this.images.map((image) => ({
          ...image,
          crop: { ...this.imageCrop(image) },
        })),
        template_frame: this.templateFrame
          ? {
            image_id: this.templateFrame.image_id,
            x: this.templateFrame.x,
            y: this.templateFrame.y,
            width: this.templateFrame.width,
            height: this.templateFrame.height,
          }
          : null,
        lane_grids: Array.from(this.laneGrids.values(), (grid) => ({
          ...grid,
          boundaries: [...grid.boundaries],
        })),
        label_rows: this.labelRows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({ ...cell })),
        })),
      };
    }

    syncState(preserveHistory = true) {
      if (this.isLoadingProject) return;
      if (!preserveHistory && !this.isApplyingHistory) {
        this.undoStack = [];
        this.redoStack = [];
        this.updateHistoryControls();
      }
      this.setSaveStatus({ label: "Editing…", state: "editing" });
      window.FigForgeRecovery?.scheduleDraft(
        document.getElementById("figure_name")?.value,
        this.state(),
      );
      if (window.Shiny?.setInputValue) window.Shiny.setInputValue("canvas_state", this.state(), { priority: "event" });
    }

    setSaveStatus(payload) {
      const label = document.querySelector(".save-indicator-label");
      const indicator = document.querySelector(".save-indicator");
      if (label) label.textContent = payload?.label || "Local draft";
      if (indicator) indicator.dataset.state = payload?.state || "draft";
    }

    showCanvasError(message) {
      if (!this.emptyState) return;
      const paragraph = this.emptyState.querySelector("p");
      if (paragraph) paragraph.textContent = message;
      this.emptyState.classList.remove("is-hidden");
    }
  }

  function initialize() {
    if (window.FigForgeCanvas) return window.FigForgeCanvas;
    const canvas = document.getElementById("figure_stage");
    const container = document.getElementById("figure_canvas");
    if (!canvas || !container) return null;
    window.FigForgeCanvas = new FigureCanvas(canvas, container);
    return window.FigForgeCanvas;
  }

  let messageHandlerRegistered = false;
  function registerMessageHandler() {
    if (messageHandlerRegistered || !window.Shiny?.addCustomMessageHandler) return;
    window.Shiny.addCustomMessageHandler("figforge:add-asset", (asset) => initialize()?.addAsset(asset));
    window.Shiny.addCustomMessageHandler("figforge:load-project", (project) => initialize()?.loadProject(project));
    window.Shiny.addCustomMessageHandler("figforge:save-status", (status) => initialize()?.setSaveStatus(status));
    messageHandlerRegistered = true;
  }

  document.addEventListener("DOMContentLoaded", () => {
    initialize();
    registerMessageHandler();
  });
  document.addEventListener("shiny:connected", registerMessageHandler);
})();
