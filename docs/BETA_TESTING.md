# Beta testing guide

Use synthetic, public, or redacted images when filing public reports.

## Core test

1. Launch FigForge and upload one lane-based PNG image.
2. Set the lane count to 30, show the guides, and adjust both outer boundaries.
3. Add rows above and below the image.
4. Paste a multirow, tab-separated block copied from a spreadsheet.
5. Move between cells with Tab, Shift+Tab, and the arrow keys.
6. Clear one cell with Backspace and confirm the image remains on the canvas.
7. Merge and unmerge both a horizontal range and a rectangular multi-row range.
8. Apply text rotation, font styling, borders, and a border extension.
9. Crop the image, reset the crop, then apply a second crop.
10. Delete the image and restore it with Ctrl/Cmd+Z.
11. Download the project, start a new project, and reopen the `.figforge` file.
12. Export PNG, TIFF, and PDF and compare each result with the editor and source.

## Template test

1. Choose **Start without image**.
2. Change the lane count and build a formatted label layout.
3. Download and reopen the `.figforge` template.
4. Attach an image and confirm the labels, merges, and formatting remain aligned.

## Browser recovery test

1. Make an edit and wait for **Browser recovery saved**.
2. Refresh the page or reopen the deployment URL in the same browser profile.
3. Choose **Restore draft** and confirm the source image and complete layout return.
4. Repeat with an image-free template.
5. Confirm that **Discard** removes the offered recovery draft.

## Reporting a problem

Open a [GitHub issue](https://github.com/mmccoy-01/figforge/issues) with:

- FigForge version;
- browser name and version;
- operating system;
- local or Posit Connect Cloud environment;
- exact reproduction steps;
- expected and actual behavior;
- console or deployment-log errors, if available.

Do not upload unpublished or sensitive research data to a public issue. A small
synthetic example that reproduces the behavior is preferred.
