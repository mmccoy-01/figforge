# FigForge

FigForge is a desktop-first scientific figure assembly app focused on fast,
structured labeling of Western blots, gels, and other lane-based images. The
current implementation includes the application shell, image canvas, lane
guides, and structured label rows.

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
figforge/static/js/          Future interactive canvas bindings
data/                        Local project data (contents ignored by Git)
tests/                       Smoke tests
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

Cells support drag and Shift-click range selection, reversible horizontal
merge/unmerge, configurable border edges, horizontal alignment, font size,
bold/italic/underline, 0°/90°/-90° text rotation, and adjustable row height.
Covered cells retain their contents while merged so unmerging is lossless.

Browsers do not consistently decode TIFF files, so FigForge creates a separate
PNG display preview of the first TIFF frame. This derivative is used only for
interactive display; the original TIFF remains unchanged and is retained as
the scientific source asset. High-bit-depth grayscale TIFF previews are scaled
to an 8-bit display range without modifying the source data.

Clipboard productivity, project persistence, and export are subsequent
milestones described in [`nextsteps.md`](nextsteps.md).

## Browser/server message contract

- `figforge:add-asset` (Shiny → browser): validated asset ID, immutable source
  URL, browser-display URL, filename, and original dimensions.
- `canvas_state` (browser → Shiny): schema version, canvas dimensions, and each
  image's source reference plus non-destructive display transform, temporary
  lane-grid state, and lane-aligned label-row contents, spans, and formatting.
