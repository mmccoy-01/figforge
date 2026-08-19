# Changelog

All notable changes to FigForge are documented here.

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
