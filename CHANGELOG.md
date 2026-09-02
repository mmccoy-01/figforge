# Changelog

All notable changes to FigForge are documented here.

## 0.14.0-beta.1 — 2026-09-02

### Added

- Per-cell text color and background fill controls, including multi-cell
  formatting and a one-click color reset.
- Tight-content publication export that removes unused canvas margins while
  retaining images, label rows, row names, and border extensions.

### Fixed

- Arrow-key cell navigation now works directly from an active text editor.
- Vertically merged cells now retain a stable focus target and accept text.
- Border extensions remain visible and accept multi-digit lengths without the
  selected cell stealing focus after the first digit.
- Crop mode removes trimmed pixels, preserves lane-label placement when the
  cropped margin is outside the lane region, and keeps its **Done** action
  enabled so the crop can be committed.
- Figure downloads are explicitly labeled as image downloads and use the
  selected PNG, TIFF, or PDF filename and media type; project downloads are
  clearly labeled as `.figforge` files.

### Compatibility

- Canvas schema 9 stores cell colors. Schema 5–8 projects remain readable and
  receive the default text and fill colors during migration.

## 0.13.0-beta.1 — 2026-08-18

First public beta candidate.

### Added

- Official FigForge application icon and browser favicon.
- PNG, JPEG, and TIFF source-image support with immutable TIFF sources and
  browser-safe previews.
- Non-destructive image movement, resizing, fitting, cropping, crop reset, and
  undo/redo for image deletion.
- Uniform lane guides for 1–30 lanes with adjustable outer boundaries.
- Spreadsheet-style lane labeling, multiline paste, productivity fills,
  horizontal and vertical merges, text formatting, borders, and border
  extensions.
- Image-independent `.figforge` templates.
- Portable `.figforge` project download and reopen workflows.
- Same-browser IndexedDB recovery for refreshed or replaced hosted sessions.
- Publication export to PNG, TIFF, and PDF at 300 or 600 DPI.
- GitHub repository link in the application header.

### Changed

- Focused the hosted interface on Upload & Label; deferred Quantification, My
  Figures, and server-side Save Version panes are not shown.
- Connect Cloud deployments default to portable-project persistence rather than
  claiming ephemeral runtime files as durable user storage.

### Beta limitations

- Desktop viewport only; individual internal lane boundaries are not adjustable.
- No user accounts, cloud database, shared project library, or hosted revision
  history.
- Browser recovery is limited to the same browser profile and deployment origin.
