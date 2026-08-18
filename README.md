# FigForge

FigForge is a desktop-first scientific figure assembly app focused on fast,
structured labeling of Western blots, gels, and other lane-based images. The
current implementation includes the image canvas, lane guides, structured label
rows, spreadsheet productivity tools, and project persistence.

## Requirements

- Python 3.11 or newer
- Windows, macOS, or Linux

## Setup

From the repository root, create a virtual environment and install FigForge:

### Windows PowerShell

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

### macOS or Linux

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

## Run

```bash
shiny run --reload app.py
```

Shiny prints the local URL to the terminal, usually
<http://127.0.0.1:8000>. Open that URL in a browser.

To expose the app to other devices on the local network, use:

```bash
shiny run --host 0.0.0.0 --port 8000 app.py
```

## Verify

```bash
pytest
```

## Project structure

```text
app.py                       Shiny application entry point
figforge/ui/                 Top-level screens and editor shell
figforge/static/css/app.css  Application styling
figforge/static/js/          Interactive canvas and Shiny browser bindings
data/                        Local project data (contents ignored by Git)
tests/                       Model, persistence, export, asset, and UI tests
```

## Current scope

The three top-level tabs and full Upload & Label workspace are in place. PNG,
JPEG, and TIFF uploads are validated and copied byte-for-byte into `data/assets`.
Uploaded images can be selected, moved, resized with their aspect ratio locked,
fit to the canvas, and deleted. The source asset is never altered; the browser
sends only a schema-versioned transform state back to Shiny.

Selected images support temporary uniform lane guides for 1–30 lanes. The left
and right guide edges are draggable, internal boundaries redistribute evenly,
opacity is adjustable, and all positions are stored as normalized coordinates.
The guides are a browser overlay and never alter the scientific image.

Structured label rows can be placed above or below a selected image. Each row
tracks the image's lane count (up to 30 cells), remains aligned to the normalized
lane region, and supports spreadsheet-style editing: click to select,
double-click or Enter to edit, Tab/Shift+Tab and arrow keys to move, Escape to
cancel, and Delete/Backspace to clear a cell. Rows can be renamed, repositioned,
or deleted from the properties panel.

Cells support drag and Shift-click range selection, reversible rectangular
merge/unmerge across columns and rows, configurable border edges, horizontal
alignment, font size, bold/italic/underline, 0°/90°/-90° text rotation, and
adjustable row height. Selected left and right borders can also be extended
toward the source image by a user-entered pixel length. Covered cells retain
their contents while merged so unmerging is lossless.

Keyboard commands are scoped to the active editing surface: Backspace/Delete
edits or clears label cells without deleting the image, and arrow keys move the
active cell. Deleting the selected canvas image can be reversed with the Undo
button or Ctrl/Cmd+Z and reapplied with Redo, Ctrl/Cmd+Shift+Z, or Ctrl/Cmd+Y.

Spreadsheet data copied from Excel or Google Sheets can be pasted directly
into a selected starting cell. Tabs populate lanes, newlines populate existing
or automatically created rows, and over-wide or merged-cell destinations are
rejected with a visible warning. Productivity helpers fill lane numbers or
repeat a selected pattern across all lanes.

Local runs autosave one mutable project draft to `data/figforge.db`. **Save**
writes immediately, and **My Figures** lists saved projects with a source-image
thumbnail and last-edited time. Opening a project restores its canvas, images,
lane guides, label rows, and cell formatting.

**Save Version** creates an immutable checkpoint with an optional note. My
Figures shows each project's version count and a newest-first history. Selecting
a version opens a read-only preview of its source image and lane-aligned labels.
Restoring historical state always creates a new head version (for example,
restoring v1 after v2 creates v3); it never deletes the intervening versions or
duplicates the immutable source image.

FigForge can also download a portable `.figforge` project bundle. A bundle keeps
the schema-versioned JSON state separate from copies of the original immutable
source images. Use **Open project** to import that file and continue editing.
Imported assets are validated again and receive new internal IDs, leaving the
bundle and existing source assets unchanged.

Projects can begin as image-independent templates. Choose **Start without
image**, set the lane count, and create or format label rows normally. Download
the result as a `.figforge` file; because it contains a template frame rather
than a scientific image, it has no bundled image assets. Opening that file later
restores the complete layout. The first subsequently uploaded image replaces
the template frame while preserving its lane grid, rows, merges, text, borders,
and formatting. Publication export remains unavailable until a real image is
attached. Changing the lane count while the template frame is active adapts the
layout: lane-number rows are regenerated, repeating row patterns continue to
the requested count, and merged groups are proportionally remapped with their
formatting intact. Templates support any requested count from 1–30 lanes.

The header **Export** action produces PNG, TIFF, or PDF output at 300 or 600
DPI. FigForge renders from the immutable source image at the requested output
resolution and redraws structured label text, formatting, horizontal/vertical
merges, borders, and border extensions.
Temporary lane guides, selection outlines, resize handles, and the checkerboard
editing background are never included. PNG and TIFF files carry DPI metadata;
PDF uses the selected resolution for its raster publication page.

Browsers do not consistently decode TIFF files, so FigForge creates a separate
PNG display preview of the first TIFF frame. This derivative is used only for
interactive display; the original TIFF remains unchanged and is retained as
the scientific source asset. High-bit-depth grayscale TIFF previews are scaled
to an 8-bit display range without modifying the source data.

Reusable templates are complete for the local and portable-project MVP. The
next major milestone in [`nextsteps.md`](nextsteps.md) is authenticated cloud
storage and per-user project ownership.

## Posit Connect Cloud persistence

Connect Cloud runtime files are temporary, so FigForge automatically uses
portable-project mode when `R_CONFIG_ACTIVE=connect_cloud` or
`QUARTO_PROFILE=connect_cloud` is present. In this mode:

1. work normally during the active browser session; FigForge caches the latest
   draft and its original source images in IndexedDB on that browser;
2. after a refresh or expired server session, choose **Restore draft** in the
   recovery banner to rebuild the project in the new Shiny session;
3. choose **Download project** before leaving or at important milestones;
4. keep the resulting `.figforge` file on the user's computer or institutional
   storage;
5. on another browser or device, choose **Open project** and select that file.

The browser recovery status beneath the project controls changes to **Browser
recovery saved** only after the current canvas JSON and every referenced source
image are available locally. Recovery works for image-backed projects and blank
templates. Source images are revalidated by the server and assigned new internal
IDs when restored.

Browser recovery is a convenience safety layer, not durable project storage. It
is limited to the same browser profile and deployment origin, and can be lost if
the user clears site data, uses private browsing, or the browser evicts storage.
FigForge requests persistent browser storage when supported, but the browser may
decline. A downloaded `.figforge` file remains the portable source of truth.

The header **Save** action in this mode only marks the current session draft as
saved; it does not claim that Connect Cloud has stored the draft permanently.
Likewise, local SQLite version history is unavailable in portable mode; download
a new `.figforge` checkpoint whenever a durable cloud-session milestone is
needed.
The **My Figures** screen explains the portable workflow and never displays a
process-wide SQLite list that could mix projects from different visitors.

Set `FIGFORGE_STORAGE_MODE=local` only for a trusted single-user deployment with
a genuinely persistent mounted data directory. Seamless cross-device project
libraries on Connect Cloud require the later account architecture: user
authentication, a persistent database, and private object storage.

## Browser/server message contract

- `figforge:add-asset` (Shiny → browser): validated asset ID, immutable source
  URL, browser-display URL, filename, and original dimensions.
- `canvas_state` (browser → Shiny): schema version, canvas dimensions, and each
  image's source reference plus non-destructive display transform, temporary
  lane-grid state, and lane-aligned label-row contents, spans, and formatting.
- `project_name_change` (browser → Shiny): the current figure name for autosave
  and portable download filenames.
- `figforge:load-project` (Shiny → browser): a validated canvas state and its
  remapped asset records.
- `figforge:save-status` (Shiny → browser): local or session-draft save status.
- `browser_recovery_request` (browser → Shiny): validated draft metadata and
  schema-versioned canvas state recovered from IndexedDB.
- `figforge:recovery-ready` (Shiny → browser): requests the required immutable
  source blobs through the hidden `recovery_upload` Shiny file input.
- `figforge:recovery-complete` / `figforge:recovery-error` (Shiny → browser):
  completes the restore banner workflow after asset remapping and validation.
- `save_version_confirm` (browser → Shiny): an atomic Save Version confirmation
  carrying the optional note.
- `history_project_request`, `preview_revision_request`, and
  `restore_revision_request` (browser → Shiny): local revision browser actions.
- `export_figure_request` (browser → Shiny): opens validated PNG, TIFF, and PDF
  export controls; the download itself is streamed by Shiny.
