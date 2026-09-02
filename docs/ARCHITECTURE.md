# Architecture

FigForge is a Shiny for Python application with a browser-owned interactive
canvas. Python validates assets, manages portable project bundles, and renders
publication exports. Browser JavaScript owns low-latency canvas interaction,
label-grid editing, undo/redo state, and same-browser recovery.

## Data principles

- Uploaded source assets are immutable.
- Crop and placement are stored as transforms rather than applied to the source.
- TIFF sources receive a separate PNG display preview when needed.
- Portable projects are ZIP-based `.figforge` bundles containing a manifest,
  schema-versioned canvas state, and copies of referenced source assets.
- Temporary lane guides and editing affordances are not publication content.

## Browser/server message contract

- `figforge:add-asset` (Shiny → browser): validated asset ID, immutable source
  URL, browser-display URL, filename, and original dimensions.
- `canvas_state` (browser → Shiny): canvas dimensions and every image's source
  reference, transform, crop, lane grid, and lane-aligned label rows, including
  text and cell-fill colors.
- `project_name_change` (browser → Shiny): current figure name for project and
  export filenames.
- `figforge:load-project` (Shiny → browser): validated canvas state with remapped
  asset records.
- `figforge:save-status` (Shiny → browser): local or session-draft save status.
- `browser_recovery_request` (browser → Shiny): IndexedDB recovery metadata and
  schema-versioned canvas state.
- `figforge:recovery-ready` (Shiny → browser): asks the browser to submit required
  immutable blobs through the hidden `recovery_upload` file input.
- `figforge:recovery-complete` / `figforge:recovery-error` (Shiny → browser):
  completes the recovery workflow after validation and asset remapping.
- `export_figure_request` (browser → Shiny): opens validated PNG, TIFF, and PDF
  export controls with tight-content or full-canvas bounds.

## Source layout

```text
app.py                         Shiny server coordination and download handlers
figforge/assets.py             Upload validation and TIFF preview generation
figforge/export.py             Publication renderer
figforge/models.py             Schema-versioned canvas models
figforge/persistence.py        Local store and portable project bundles
figforge/ui/                   Shiny UI composition
figforge/static/js/canvas.js   Canvas and label-grid interaction
figforge/static/js/browser_recovery.js
                               IndexedDB draft recovery
figforge/static/css/app.css    Application styling
```

When the canvas schema changes, update both the Python schema constant and the
browser constant, provide migration behavior where practical, and add a test for
the previous supported schema.
