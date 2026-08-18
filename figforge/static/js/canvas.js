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

  const SCHEMA_VERSION = 5;
  const MAX_LANES = 30;
  const DEFAULT_LANE_OPACITY = 0.35;
  const DEFAULT_GRID_LEFT = 0.05;
  const DEFAULT_GRID_RIGHT = 0.95;
  const MIN_GRID_SPAN = 0.04;
  const HANDLE_SIZE = 11;
  const MIN_IMAGE_SIZE = 36;
  const SELECTION_COLOR = "#087f72";

  class FigureCanvas {
    constructor(canvas, container) {
      this.canvas = canvas;
      this.container = container;
      this.context = canvas.getContext("2d");
      this.emptyState = document.getElementById("canvas_empty_state");
      this.images = [];
      this.imageElements = new Map();
      this.laneGrids = new Map();
      this.labelRows = [];
      this.selectedId = null;
      this.selectedCell = null;
      this.selectionAnchor = null;
      this.editingCell = null;
      this.draggingSelection = false;
      this.interaction = null;
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
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
        if ((event.key === "Delete" || event.key === "Backspace") && this.selectedId) {
          event.preventDefault();
          this.deleteSelected();
        }
      });

      document.addEventListener("click", (event) => {
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
      document.getElementById("delete_image")?.addEventListener("click", () => this.deleteSelected());
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

      const labelOverlay = document.getElementById("label_grid_overlay");
      labelOverlay?.addEventListener("pointerdown", (event) => this.handleCellPointerDown(event));
      labelOverlay?.addEventListener("pointerover", (event) => this.handleCellPointerOver(event));
      labelOverlay?.addEventListener("pointermove", (event) => this.handleCellPointerOver(event));
      labelOverlay?.addEventListener("dblclick", (event) => this.handleCellDoubleClick(event));
      labelOverlay?.addEventListener("keydown", (event) => this.handleCellKeyDown(event));
      labelOverlay?.addEventListener("input", (event) => this.handleCellInput(event));
      labelOverlay?.addEventListener("focusout", (event) => this.handleCellBlur(event));
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
      const existing = this.images.find((image) => image.asset_id === asset.asset_id);
      if (existing) {
        this.select(existing.image_id);
        return;
      }

      const imageElement = new Image();
      imageElement.decoding = "async";
      imageElement.onload = () => {
        const imageId = `image_${crypto.randomUUID()}`;
        const size = this.fittedSize(asset.width, asset.height, 0.72, 0.7);
        const image = {
          image_id: imageId,
          asset_id: asset.asset_id,
          filename: asset.filename,
          source_url: asset.source_url || asset.url,
          display_url: asset.url,
          original_width: asset.width,
          original_height: asset.height,
          x: Math.round((this.stageWidth - size.width) / 2),
          y: Math.round((this.stageHeight - size.height) / 2),
          width: size.width,
          height: size.height,
          rotation: 0,
        };
        this.imageElements.set(imageId, imageElement);
        this.images.push(image);
        this.select(imageId);
        this.syncState();
      };
      imageElement.onerror = () => this.showCanvasError(`Could not display ${asset.filename}`);
      imageElement.src = asset.url;
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
      const size = this.fittedSize(image.original_width, image.original_height, 0.86, 0.82);
      image.width = size.width;
      image.height = size.height;
      image.x = Math.round((this.stageWidth - size.width) / 2);
      image.y = Math.round((this.stageHeight - size.height) / 2);
      this.draw();
      this.updateProperties();
      this.syncState();
    }

    deleteSelected() {
      if (!this.selectedId) return;
      const deleteId = this.selectedId;
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
      this.syncState();
    }

    select(imageId) {
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
      return this.images.find((image) => image.image_id === this.selectedId) || null;
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
      grid.lane_count = laneCount;
      grid.uniform = true;
      grid.boundaries = [];
      this.resizeRowsForGrid(grid.image_id, laneCount);
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

      if (this.interaction.type === "lane-boundary") {
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
      this.interaction = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      this.syncState();
      this.updateCursor(this.pointerPosition(event));
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
      for (let index = this.images.length - 1; index >= 0; index -= 1) {
        const image = this.images[index];
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

    updateCursor(point) {
      const selected = this.selectedImage();
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
      for (const image of this.images) {
        const element = this.imageElements.get(image.image_id);
        if (element) this.context.drawImage(element, image.x, image.y, image.width, image.height);
        const grid = this.laneGrids.get(image.image_id);
        if (grid?.visible) this.drawLaneGrid(image, grid, image.image_id === this.selectedId);
      }
      const selected = this.selectedImage();
      if (selected) this.drawSelection(selected);
      this.emptyState?.classList.toggle("is-hidden", this.images.length > 0);
      this.positionLabelRows();
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
      if (label) label.textContent = image ? image.filename : "Nothing selected";
      document.getElementById("fit_image")?.toggleAttribute("disabled", !image);
      document.getElementById("delete_image")?.toggleAttribute("disabled", !image);
      document.getElementById("add_row")?.toggleAttribute("disabled", !image);
      this.updateLaneControls(image);
      this.updateRowControls(image);
      this.updateFormattingControls();

      document.querySelectorAll("[data-figforge-asset]").forEach((button) => {
        button.classList.toggle("is-active", Boolean(image && button.dataset.assetId === image.asset_id));
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
      const grid = this.selectedGrid() || this.createLaneGrid(image, false);
      const rowNumber = this.labelRows.filter((row) => row.image_id === image.image_id).length + 1;
      const row = {
        row_id: `row_${crypto.randomUUID()}`,
        image_id: image.image_id,
        name: `Row ${rowNumber}`,
        position,
        height: 30,
        cells: Array.from({ length: grid.lane_count }, () => this.defaultCell()),
      };
      this.labelRows.push(row);
      this.selectedCell = { rowId: row.row_id, col: 0 };
      this.selectionAnchor = { ...this.selectedCell };
      this.renderLabelRows();
      this.updateProperties();
      this.focusSelectedCell();
      this.syncState();
    }

    deleteSelectedRow() {
      const row = this.selectedRow();
      if (!row) return;
      this.finishEditing(true);
      this.labelRows = this.labelRows.filter((candidate) => candidate.row_id !== row.row_id);
      this.selectedCell = null;
      this.selectionAnchor = null;
      this.renderLabelRows();
      this.updateProperties();
      this.syncState();
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
      row.position = position;
      this.renderLabelRows();
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
      this.renderLabelRows();
      this.focusSelectedCell();
      this.syncState();
    }

    defaultCell() {
      return {
        text: "",
        colspan: 1,
        merged_into: null,
        align: "center",
        vertical_align: "middle",
        font_size: 12,
        bold: false,
        italic: false,
        underline: false,
        rotation: 0,
        borders: { top: true, right: true, bottom: true, left: true },
      };
    }

    selectedRow() {
      if (!this.selectedCell) return null;
      return this.labelRows.find((row) => row.row_id === this.selectedCell.rowId) || null;
    }

    resizeRowsForGrid(imageId, laneCount) {
      let changed = false;
      for (const row of this.labelRows.filter((candidate) => candidate.image_id === imageId)) {
        if (row.cells.length > laneCount) {
          row.cells = row.cells.slice(0, laneCount);
          changed = true;
        }
        while (row.cells.length < laneCount) {
          row.cells.push(this.defaultCell());
          changed = true;
        }
        this.normalizeMerges(row);
      }
      if (this.selectedCell && this.selectedCell.col >= laneCount) {
        this.selectedCell.col = laneCount - 1;
      }
      if (this.selectionAnchor && this.selectionAnchor.col >= laneCount) {
        this.selectionAnchor.col = laneCount - 1;
      }
      if (changed) this.renderLabelRows();
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
          if (cell.merged_into !== null) return;
          const cellElement = document.createElement("div");
          cellElement.className = "label-cell";
          cellElement.dataset.rowId = row.row_id;
          cellElement.dataset.column = String(column);
          cellElement.dataset.colspan = String(cell.colspan);
          cellElement.style.gridColumn = `${column + 1} / span ${cell.colspan}`;
          cellElement.contentEditable = "false";
          cellElement.tabIndex = 0;
          cellElement.setAttribute("role", "gridcell");
          cellElement.setAttribute(
            "aria-label",
            cell.colspan > 1
              ? `${row.name}, lanes ${column + 1} through ${column + cell.colspan}`
              : `${row.name}, lane ${column + 1}`,
          );
          cellElement.textContent = cell.text;
          this.applyCellElementStyle(cellElement, cell, row, column);
          rowElement.append(cellElement);
        });
        overlay.append(rowElement);
      }
      this.positionLabelRows();
      this.updateCellSelection();
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
      element.style.transform = cell.rotation === -90 ? "rotate(180deg)" : "none";
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
      for (const image of this.images) {
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

    handleCellPointerOver(event) {
      if (!this.draggingSelection) return;
      const cell = event.target.closest(".label-cell");
      if (!cell) return;
      event.preventDefault();
      this.selectCell(cell.dataset.rowId, Number(cell.dataset.column), false, true);
    }

    handleCellDoubleClick(event) {
      const cell = event.target.closest(".label-cell");
      if (!cell) return;
      event.preventDefault();
      event.stopPropagation();
      this.beginCellEdit(cell.dataset.rowId, Number(cell.dataset.column));
    }

    handleCellKeyDown(event) {
      const cell = event.target.closest(".label-cell");
      if (!cell) return;
      const rowId = cell.dataset.rowId;
      const column = Number(cell.dataset.column);
      const editing = cell.contentEditable === "true";

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

    selectCell(rowId, column, focus = true, extend = false) {
      const row = this.labelRows.find((candidate) => candidate.row_id === rowId);
      if (!row || !row.cells[column]) return;
      column = row.cells[column].merged_into ?? column;
      this.selectedId = row.image_id;
      this.selectedCell = { rowId, col: column };
      if (!extend || !this.selectionAnchor) this.selectionAnchor = { ...this.selectedCell };
      this.draw();
      this.updateProperties();
      this.updateCellSelection();
      if (focus) this.focusSelectedCell();
    }

    beginCellEdit(rowId, column, initialText = null) {
      this.selectCell(rowId, column, false);
      const cell = this.cellElement(rowId, column);
      const row = this.labelRows.find((candidate) => candidate.row_id === rowId);
      if (!cell || !row) return;
      this.editingCell = { rowId, col: column, original: row.cells[column].text };
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
      const { rowId, col, original } = this.editingCell;
      const row = this.labelRows.find((candidate) => candidate.row_id === rowId);
      const cell = this.cellElement(rowId, col);
      if (row?.cells[col] && cell) {
        row.cells[col].text = commit ? cell.textContent.replace(/[\r\n]+/g, " ") : original;
        cell.textContent = row.cells[col].text;
        cell.contentEditable = "false";
      }
      this.editingCell = null;
      this.updateCellSelection();
      if (commit) this.syncState();
    }

    moveCellSelection(horizontal, vertical, extend = false) {
      if (!this.selectedCell) return;
      const rows = this.labelRows.filter((row) => row.image_id === this.selectedId);
      const rowIndex = rows.findIndex((row) => row.row_id === this.selectedCell.rowId);
      if (rowIndex < 0) return;
      let nextRow = rowIndex + vertical;
      const currentCell = rows[rowIndex].cells[this.selectedCell.col];
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
      nextColumn = rows[nextRow].cells[nextColumn].merged_into ?? nextColumn;
      this.selectCell(rows[nextRow].row_id, nextColumn, true, extend);
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
      const anchorSpan = rows[anchorRow].cells[this.selectionAnchor.col]?.colspan || 1;
      const focusSpan = rows[focusRow].cells[this.selectedCell.col]?.colspan || 1;
      const top = Math.min(anchorRow, focusRow);
      const bottom = Math.max(anchorRow, focusRow);
      let left = Math.min(this.selectionAnchor.col, this.selectedCell.col);
      let right = Math.max(
        this.selectionAnchor.col + anchorSpan - 1,
        this.selectedCell.col + focusSpan - 1,
      );
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (let rowIndex = top; rowIndex <= bottom; rowIndex += 1) {
          rows[rowIndex].cells.forEach((cell, column) => {
            if (cell.merged_into !== null || cell.colspan <= 1) return;
            const end = column + cell.colspan - 1;
            if (end >= left && column <= right && (column < left || end > right)) {
              left = Math.min(left, column);
              right = Math.max(right, end);
              expanded = true;
            }
          });
        }
      }
      return {
        rows,
        top,
        bottom,
        left,
        right,
      };
    }

    selectionIncludes(rowId, column, colspan = 1) {
      const bounds = this.selectionBounds();
      if (!bounds) return false;
      const rowIndex = bounds.rows.findIndex((row) => row.row_id === rowId);
      const end = column + colspan - 1;
      return rowIndex >= bounds.top && rowIndex <= bounds.bottom && end >= bounds.left && column <= bounds.right;
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
      for (const { cell } of entries) {
        if (cell.merged_into === null) cell.text = "";
      }
      this.renderLabelRows();
      this.focusSelectedCell();
      this.syncState();
    }

    normalizeMerges(row) {
      const anchors = row.cells.map((cell) => cell.merged_into === null ? cell.colspan : 1);
      for (const cell of row.cells) {
        cell.colspan = 1;
        cell.merged_into = null;
      }
      for (let column = 0; column < row.cells.length; column += 1) {
        const span = Math.min(Math.max(1, anchors[column] || 1), row.cells.length - column);
        row.cells[column].colspan = span;
        for (let covered = column + 1; covered < column + span; covered += 1) {
          row.cells[covered].merged_into = column;
        }
        column += span - 1;
      }
    }

    selectedMergeAnchors() {
      const anchors = new Map();
      for (const { row, column, cell } of this.selectedCellEntries()) {
        const anchorColumn = cell.merged_into ?? column;
        const anchor = row.cells[anchorColumn];
        if (anchor?.colspan > 1) anchors.set(`${row.row_id}:${anchorColumn}`, { row, column: anchorColumn, cell: anchor });
      }
      return Array.from(anchors.values());
    }

    canMergeSelection() {
      const bounds = this.selectionBounds();
      if (!bounds || bounds.top !== bounds.bottom || bounds.left >= bounds.right) return false;
      const row = bounds.rows[bounds.top];
      for (let column = bounds.left; column <= bounds.right; column += 1) {
        const cell = row.cells[column];
        if (!cell || cell.merged_into !== null || cell.colspan !== 1) return false;
      }
      return true;
    }

    toggleMergeSelected() {
      this.finishEditing(true);
      const existing = this.selectedMergeAnchors();
      if (existing.length) {
        for (const { row, column, cell } of existing) {
          const end = Math.min(row.cells.length, column + cell.colspan);
          cell.colspan = 1;
          for (let covered = column + 1; covered < end; covered += 1) row.cells[covered].merged_into = null;
        }
      } else if (this.canMergeSelection()) {
        const bounds = this.selectionBounds();
        const row = bounds.rows[bounds.top];
        const anchor = row.cells[bounds.left];
        anchor.colspan = bounds.right - bounds.left + 1;
        for (let column = bounds.left + 1; column <= bounds.right; column += 1) {
          row.cells[column].merged_into = bounds.left;
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
      for (const id of ["align_left", "align_center", "align_right", "cell_bold", "cell_italic", "cell_underline", "cell_font_size", "cell_rotation", "cell_border_preset", "cell_borders", "rotate_object"]) {
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
      const borders = document.getElementById("cell_border_preset");
      if (fontSize && focused) fontSize.value = String(focused.font_size);
      if (rotation && focused) rotation.value = String(focused.rotation);
      if (borders && active) {
        const everyAll = entries.every(({ cell }) => Object.values(cell.borders).every(Boolean));
        const everyNone = entries.every(({ cell }) => Object.values(cell.borders).every((value) => !value));
        borders.value = everyAll ? "all" : everyNone ? "none" : "custom";
      }
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
        images: this.images.map((image) => ({ ...image })),
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

    syncState() {
      if (window.Shiny?.setInputValue) window.Shiny.setInputValue("canvas_state", this.state(), { priority: "event" });
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
    messageHandlerRegistered = true;
  }

  document.addEventListener("DOMContentLoaded", () => {
    initialize();
    registerMessageHandler();
  });
  document.addEventListener("shiny:connected", registerMessageHandler);
})();
