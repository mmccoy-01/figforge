# FigForge — Next Steps

## Goal

Build **FigForge**, a Shiny-based scientific figure assembly app focused first on seamless labeling and layout of Western blots, gels, and similar lane-based images.

The MVP should make this workflow fast:

1. Upload a gel/blot image.
2. Enter the number of wells/lanes.
3. Click a button to display temporary lane/grid guides over the image.
4. Adjust the lane grid to match the image **without distorting the source image**.
5. Add spreadsheet-like label rows above or below the image.
6. Edit labels with fast keyboard-driven interactions.
7. Merge cells, rotate text, control borders, and align text.
8. Save the project state.
9. Reopen and continue editing later.
10. Export a publication-quality figure.

Do **not** try to clone all of Sciugo in the first version. The core differentiator should be an unusually intuitive lane/grid + metadata labeling workflow.

---

# 1. Recommended Stack

## Application

Use:

- **Python**
- **Shiny for Python**
- Custom JavaScript/TypeScript for the interactive figure canvas
- **Konva.js** or an equivalent canvas library for:
  - image placement
  - resizing
  - cropping
  - selection
  - guide overlays
  - drag handles
  - layer rendering
- CSS for polished desktop-first layout

The Shiny app should remain responsible for:

- app state
- project state
- image metadata
- persistence
- export coordination
- future quantification
- future authentication integration

The JavaScript canvas should be responsible for interactions that need to feel immediate.

Do not attempt to emulate an interactive graphics editor using repeated server-side plot rerenders.

---

# 2. First Milestone: Local Single-User MVP

Do this before accounts, cloud deployment, collaboration, or quantification.

## Required Screens

Create three top-level tabs:

- **Upload & Label**
- **Quantification**
- **My Figures**

For the MVP:

- Upload & Label = functional
- Quantification = placeholder
- My Figures = functional for locally saved projects

The visual structure should roughly follow this pattern:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Upload & Label     Quantification     My Figures                 Save/Export │
├────────────────┬──────────────────────────────────────┬──────────────────────┤
│ PROJECT/ASSETS │                                      │ PROPERTIES           │
│                │                                      │                      │
│ figure name    │            FIGURE CANVAS             │ selected object      │
│ image list     │                                      │ dimensions           │
│                │                                      │ alignment            │
│ + Upload       │                                      │ text settings        │
│                │                                      │ border settings      │
├────────────────┴──────────────────────────────────────┴──────────────────────┤
│ Toolbar: Select | Crop | Add Row | Merge | Borders | Rotate | Undo | Redo   │
└──────────────────────────────────────────────────────────────────────────────┘
```

The center canvas should receive the majority of available screen width.

---

# 3. Image Upload

Support initially:

- PNG
- JPG/JPEG
- TIFF/TIF if practical

Store the original uploaded image unchanged.

Never overwrite or destructively alter the original.

On upload, record:

```python
{
    "asset_id": "...",
    "filename": "...",
    "width": ...,
    "height": ...,
    "mime_type": "...",
    "created_at": "..."
}
```

Display uploaded images in the left asset panel.

Clicking an image should add or select it on the canvas.

---

# 4. Lane / Well Grid

This is a core feature and should be treated as a first-class object.

## User Flow

The user:

1. uploads an image;
2. selects the image;
3. enters a lane count, e.g. `26`;
4. clicks **Show Lane Guides**.

The app creates a temporary lane guide overlay.

Example:

```text
┌────────────────────────────────────────────┐
│ | | | | | | | | | | | | | | | | | | |  │
│ | | | | | | | | | | | | | | | | | | |  │
│                 blot                       │
│ | | | | | | | | | | | | | | | | | | |  │
└────────────────────────────────────────────┘
```

## Important Behavior

The user should adjust the **grid to the image**, not stretch the scientific image to match the grid.

Default behavior:

- image aspect ratio remains locked;
- grid has left and right outer handles;
- moving the handles changes the lane region;
- internal lane boundaries redistribute evenly;
- grid opacity is low enough to see the bands clearly;
- grid guides are temporary and excluded from final export unless explicitly enabled.

Controls:

- Lane count
- Show/hide guides
- Reset grid
- Uniform lanes toggle
- Grid opacity

### Optional second-stage behavior

When `Uniform lanes = OFF`:

- allow individual internal lane boundaries to be dragged;
- retain each lane width in the project state.

Represent the lane structure approximately as:

```json
{
  "lane_count": 26,
  "left": 0.12,
  "right": 0.93,
  "uniform": true,
  "boundaries": []
}
```

Prefer normalized coordinates rather than raw pixels where practical.

---

# 5. Label Grid

The label grid is the most important UX feature after the lane guides.

Do not treat every label as an arbitrary floating text box.

Treat labels as structured spreadsheet-like cells aligned to lanes.

## Label Rows

Allow the user to add metadata rows above or below an image.

Example:

```text
               Group 4 VTA GluA2
Rat ID       | 7 | 1 | 8 | 2 | 9 | 3 | 10 | 4 |
Status       | S | I | S | I | S | I | S  | I |
Group        |--------- G4A ---------|---- G4B ---|
Lane         | 1 | 2 | 3 | 4 | 5 | 6 | 7  | 8 |
```

Each standard row should initially contain one cell per lane.

## Cell Editing

Implement:

- click a cell to select it;
- double-click or press Enter to edit;
- Tab moves right;
- Shift+Tab moves left;
- Enter moves down when appropriate;
- arrow keys move selection;
- Escape exits editing;
- Delete/Backspace clears selected cell contents;
- typing while a cell is selected starts editing immediately.

Aim for spreadsheet-like keyboard behavior.

---

# 6. Multi-Cell Selection

Support:

- click and drag to select multiple cells;
- Shift+click to extend selection;
- optional Ctrl/Cmd click for non-contiguous selection later.

Selected cells should have a visible selection outline.

Actions should apply to the full selection.

---

# 7. Merge / Unmerge Cells

Allow horizontally adjacent cells to be merged.

Example:

```text
Before:
| G4A | G4A | G4A | G4A |

After:
|--------- G4A ---------|
```

For the MVP, horizontal merging is required.

Vertical merging may be deferred.

A merged cell must preserve:

- start lane
- end lane
- row
- text
- alignment
- borders
- rotation
- style

Example internal representation:

```python
{
    "row_id": "group",
    "start_col": 1,
    "colspan": 4,
    "text": "G4A",
    "rotation": 0,
    "align": "center"
}
```

Unmerge should restore the underlying lane cells.

---

# 8. Vertical / Rotated Text

Support at minimum:

- 0°
- 90°
- -90°

Use this for labels such as:

```text
M
W
M
```

or a rotated `MWM` label beside the gel.

Expose text rotation in the toolbar or properties panel.

Do not permanently rasterize text while editing.

---

# 9. Cell Borders

Provide intuitive border controls similar to spreadsheet software.

Required options:

- None
- All borders
- Outer border
- Top
- Bottom
- Left
- Right

Later:

- border width
- dotted/dashed
- border drawing mode

Border choices should be stored per cell/merged range.

---

# 10. Text Formatting

Support:

- font size
- bold
- italic
- underline
- horizontal alignment:
  - left
  - center
  - right
- vertical alignment:
  - top
  - middle
  - bottom
- text rotation

Use a restrained default scientific figure font.

Do not expose excessive decorative typography in the MVP.

---

# 11. Paste From Excel / Google Sheets

This should be a high-priority feature.

If the user copies tabular data such as:

```text
7	1	8	2
S	I	S	I
WT	WT	KO	KO
```

and pastes into a selected starting cell, populate the label grid across rows and columns.

Support:

- tab-separated columns;
- newline-separated rows.

Reject or warn when pasted data exceeds the available lane count.

This feature should require as few clicks as possible.

---

# 12. Fill / Repeat Helpers

Add simple productivity helpers.

## Fill lane numbers

One click:

```text
1 2 3 4 5 6 7 ... N
```

## Repeat a selected pattern

If the user selects:

```text
S | I
```

allow:

```text
Repeat across row
```

Result:

```text
S | I | S | I | S | I | ...
```

Similarly:

```text
WT | KO
```

or:

```text
A | B | C
```

This can come after basic paste support.

---

# 13. Row Management

Support:

- Add row above
- Add row below
- Delete row
- Rename row
- Change row height
- Move row up/down

Rows should be draggable later, but button-based reordering is sufficient initially.

Possible row types:

```text
Generic
Lane Number
Sample ID
Group
Status
Genotype
Molecular Weight
```

For the MVP, all can internally use one generic row model with optional presets.

---

# 14. Image Editing

Keep the MVP conservative.

Required:

- resize while preserving aspect ratio;
- move;
- crop;
- rotate 90°;
- reset crop.

Optional later:

- brightness;
- contrast;
- grayscale/invert;
- intensity adjustments.

Scientific image edits must be non-destructive.

Store operations rather than modifying the source asset.

Example:

```json
{
  "asset_id": "img_001",
  "transform": {
    "x": 320,
    "y": 180,
    "width": 900,
    "height": 250,
    "rotation": 0
  },
  "crop": {
    "x": 34,
    "y": 21,
    "width": 1532,
    "height": 411
  }
}
```

---

# 15. Undo / Redo

Create an explicit command/history system.

Required actions should be undoable:

- text edit
- add/delete row
- merge/unmerge
- border change
- grid adjustment
- image move
- image resize
- crop
- rotation

Maintain separate concepts:

```text
Undo/Redo
    =
short-term editing history

Autosave
    =
crash/browser recovery

Version history
    =
long-term project checkpoints
```

Do not conflate them.

---

# 16. Project State

A project should be serializable to JSON.

Suggested top-level structure:

```json
{
  "schema_version": 1,
  "project_id": "...",
  "name": "VTA GluA2",
  "created_at": "...",
  "updated_at": "...",
  "canvas": {},
  "assets": [],
  "images": [],
  "lane_grids": [],
  "label_rows": [],
  "settings": {}
}
```

The source image should not be embedded in JSON.

Reference uploaded assets by ID/path.

---

# 17. Local Persistence First

Before implementing accounts, create a simple local persistence layer.

Use:

- SQLite for project metadata/state
- local app data folder for uploaded images

Suggested structure:

```text
data/
├── figforge.db
└── assets/
    ├── <asset-id>.tif
    ├── <asset-id>.png
    └── ...
```

Tables:

```text
projects
assets
revisions
```

Minimal schema:

```sql
projects
--------
id
name
created_at
updated_at
current_revision_id

assets
------
id
project_id
original_filename
storage_path
mime_type
width
height
created_at

revisions
---------
id
project_id
parent_revision_id
created_at
note
state_json
```

---

# 18. Autosave

Autosave the working project periodically and after meaningful changes.

Target behavior:

```text
Editing...
Saved
```

Do not create a permanent historical revision for every keystroke.

Maintain one mutable current draft.

---

# 19. Version History

Add a **Save Version** action.

The user may optionally add a note:

```text
Added Rat IDs
Adjusted G4B boundary
Final labels before export
```

Version history view:

```text
v18  Added Rat IDs          Aug 18, 4:31 PM
v17  Adjusted G4B boundary  Aug 18, 4:24 PM
v16  Added Status row       Aug 18, 4:18 PM
```

Clicking a historical revision should show a read-only preview.

Provide:

```text
Restore this version
```

Restoring an old version must create a **new** revision.

Example:

```text
v19 — Restored from v15
```

Never delete newer revisions automatically.

---

# 20. My Figures

Implement a local project browser.

Each card/row should show:

- project name;
- thumbnail;
- last edited timestamp;
- created timestamp;
- optional tags later.

Actions:

- Open
- Rename
- Duplicate
- Delete
- Version history

Add search and sort later.

---

# 21. Export

Initial export formats:

- PNG
- TIFF if practical
- PDF

Requirements:

- lane guides excluded by default;
- selectable output DPI;
- labels remain crisp;
- exported output matches on-screen layout;
- original scientific image pixels should not be needlessly resampled.

Provide common presets:

```text
300 DPI
600 DPI
```

Later add exact physical dimensions in inches/mm.

---

# 22. Templates

After the core editor works, add **Save as Template**.

Template should preserve:

- number and order of label rows;
- row names;
- merged ranges;
- font settings;
- borders;
- label orientation;
- image placeholder structure.

Template should not need to include experimental images.

New project dialog:

```text
Blank
Western Blot
PCR Gel
Genotyping Gel
Custom Template...
```

The user should be able to choose a template and enter a lane count.

Where possible, adapt the template automatically to the new lane count.

---

# 23. Cloud / Account Architecture

Do not implement until the local single-user MVP is stable.

Recommended later architecture:

```text
Shiny for Python
       |
       +---- Supabase Auth
       |
       +---- Postgres
       |
       +---- Object Storage
```

Conceptually:

```text
Auth
  -> users

Postgres
  -> projects
  -> revisions
  -> permissions
  -> templates

Object Storage
  -> TIFF
  -> PNG
  -> JPEG
  -> generated exports
```

The app filesystem must never be treated as persistent cloud storage.

---

# 24. Cloud Database Design

Suggested future schema:

```text
users
projects
project_members
assets
revisions
templates
```

## projects

```text
id
owner_id
name
created_at
updated_at
current_revision_id
```

## project_members

```text
project_id
user_id
role
```

Possible roles:

```text
owner
editor
viewer
```

## assets

```text
id
project_id
storage_key
original_filename
sha256
mime_type
width
height
created_at
```

## revisions

```text
id
project_id
parent_revision_id
author_id
state_json
note
created_at
```

---

# 25. Do Not Duplicate Assets Per Revision

This is important.

Do NOT do:

```text
revision 1 -> copy of 50 MB TIFF
revision 2 -> copy of 50 MB TIFF
revision 3 -> copy of 50 MB TIFF
```

Instead:

```text
                 source TIFF
                 /    |    \
               v1    v2    v3
              JSON  JSON  JSON
```

The image exists once.

Each revision points to the same immutable asset unless the user uploads a replacement.

Use file hashes to detect identical uploads later.

---

# 26. Security / Privacy for Cloud Version

When cloud functionality is added:

- projects private by default;
- object storage private by default;
- enforce project ownership/permissions server-side;
- do not rely only on hidden UI controls;
- prevent users from guessing another user's asset URL;
- use signed URLs or authenticated file access;
- validate uploaded file types;
- sanitize filenames;
- enforce reasonable file-size limits;
- never expose service-role credentials to the browser.

This app may contain unpublished scientific data, so privacy must be a core design constraint.

---

# 27. Quantification — Deferred

Do not build quantification until labeling and figure persistence are solid.

The Quantification tab should initially show:

```text
Coming later
```

Future features may include:

- lane ROI definition;
- band ROI definition;
- background subtraction;
- integrated density;
- normalization to loading control;
- CSV export;
- linking quantified values to figure lanes.

Keep quantification logically separate from basic figure assembly.

---

# 28. Auditability

A future goal is to make image handling transparent and non-destructive.

Eventually include:

```text
Image History
```

showing operations such as:

```text
Original: blot_01.tif
Crop: x=...
Contrast: ...
Rotation: ...
```

The source file should always remain recoverable.

Do not implement arbitrary pixel painting, cloning, erasing, or content-aware manipulation.

---

# 29. UX Principles

These are requirements, not optional polish.

## Minimize clicks

Common tasks should be extremely fast:

```text
Upload -> lanes -> paste labels -> merge groups -> export
```

## Keyboard-friendly

A researcher labeling 26–40 lanes should not need to click every cell.

## Spreadsheet mental model

Rows and cells should behave close enough to Excel/Google Sheets that interaction is immediately understandable.

## Scientific-image mental model

Images are immutable source data with non-destructive display transforms.

## No arbitrary complexity

Do not turn the first release into Illustrator.

The structured grid is the product advantage.

---

# 30. Suggested Repository Layout

Start with something like:

```text
figforge/
├── app.py
├── README.md
├── NEXTSTEPS.md
├── pyproject.toml
│
├── figforge/
│   ├── __init__.py
│   ├── models.py
│   ├── state.py
│   ├── persistence.py
│   ├── export.py
│   │
│   ├── ui/
│   │   ├── upload_label.py
│   │   ├── my_figures.py
│   │   └── quantification.py
│   │
│   └── static/
│       ├── css/
│       │   └── app.css
│       └── js/
│           ├── canvas.js
│           ├── label_grid.js
│           └── shiny_bindings.js
│
├── data/
│   └── .gitkeep
│
└── tests/
    ├── test_state.py
    ├── test_persistence.py
    └── test_revisions.py
```

Adjust this structure if Shiny's component organization suggests a cleaner approach.

---

# 31. Implementation Order

Codex should work in this order.

## Phase 1 — Scaffold

- [x] Create runnable Shiny for Python application.
- [x] Add three top navigation tabs.
- [x] Create left asset panel, central canvas area, right properties panel.
- [x] Add basic CSS.
- [x] Confirm application starts with one documented command.

## Phase 2 — Image Canvas

- [x] Upload PNG/JPEG.
- [x] Upload TIFF with an immutable source and browser-safe display preview.
- [x] Add uploaded image to canvas.
- [x] Select image.
- [x] Move image.
- [x] Resize image with aspect ratio preserved.
- [x] Delete image.
- [x] Serialize canvas image state.

## Phase 3 — Lane Guides

- [x] Lane count input (maximum 30).
- [x] Show/hide guides button.
- [x] Draw N evenly distributed lane guides.
- [x] Adjustable outer left/right boundaries.
- [x] Preserve image geometry.
- [x] Store normalized lane-grid state.
- [x] Keep guides as a temporary overlay, separate from future exports.

## Phase 4 — Label Rows

- [x] Add row.
- [x] Render one cell per lane.
- [x] Edit cells.
- [x] Keyboard navigation.
- [x] Delete row.
- [x] Rename row.
- [x] Row position above/below image.

## Phase 5 — Label Formatting

- [x] Multi-cell selection.
- [x] Merge.
- [x] Unmerge.
- [x] Borders.
- [x] Horizontal alignment.
- [x] Font size.
- [x] Bold/italic.
- [x] Text rotation.
- [x] Row height.

## Phase 6 — Clipboard Productivity

- [ ] Paste tab-separated data.
- [ ] Paste multiline data.
- [ ] Fill lane numbers.
- [ ] Repeat selected pattern.

## Phase 7 — Project Persistence

- [ ] Define project JSON schema.
- [ ] SQLite database.
- [ ] Save project.
- [ ] Autosave.
- [ ] Open project.
- [ ] My Figures view.
- [ ] Project thumbnail.

## Phase 8 — Revision History

- [ ] Save Version.
- [ ] Optional version note.
- [ ] Revision list.
- [ ] Revision preview.
- [ ] Restore old revision as new revision.

## Phase 9 — Export

- [ ] PNG export.
- [ ] PDF export.
- [ ] 300 DPI preset.
- [ ] 600 DPI preset.
- [ ] Ensure temporary guides are excluded.

## Phase 10 — Templates

- [ ] Save current structure as template.
- [ ] New project from template.
- [ ] Adapt template to requested lane count.

Only after all of the above:

## Phase 11 — Accounts / Cloud

- [ ] Supabase authentication.
- [ ] Cloud Postgres persistence.
- [ ] Private object storage.
- [ ] Per-user project ownership.
- [ ] Cloud revision history.
- [ ] Migration path from local projects.

---

# 32. MVP Acceptance Test

A user should be able to complete this exact workflow:

1. Launch FigForge.
2. Upload one Western blot image.
3. Enter `26` lanes.
4. Click **Show Lane Guides**.
5. Adjust the left/right guide bounds to align the lanes.
6. Add a row called `Rat ID`.
7. Paste 26 animal IDs from Excel.
8. Add a row called `Status`.
9. Paste or repeat `S / I`.
10. Add a row called `Group`.
11. Merge lanes 1–13 and label them `G4A`.
12. Merge lanes 14–26 and label them `G4B`.
13. Add a `Lane` row and autofill 1–26.
14. Add a vertically rotated `MWM` label.
15. Add outer and bottom borders to selected cells.
16. Save the project.
17. Close and restart the app.
18. Reopen the project.
19. Continue editing exactly where it was left.
20. Save a named version.
21. Make a change.
22. Restore the prior version.
23. Export a clean high-resolution image with no temporary lane guides.

If this workflow is smooth, the MVP is successful.

---

# 33. Coding Guidance for Codex

While implementing:

- Work in small commits.
- Keep the app runnable after every meaningful change.
- Do not silently change the project schema.
- Add a `schema_version` immediately.
- Prefer clear models over storing UI state ad hoc.
- Separate canvas state from persistence.
- Keep original uploaded assets immutable.
- Write tests for:
  - project serialization;
  - merge/unmerge;
  - revision creation;
  - revision restore;
  - autosave behavior.
- Document any JavaScript ↔ Shiny messages.
- Avoid adding large frameworks unless they solve a real interaction problem.
- Do not start cloud deployment before the local editor works well.
- Do not start quantification before labeling, saving, and reopening work reliably.
- Prioritize responsiveness and low-friction labeling over visual ornamentation.

---

# 34. First Codex Task

Start with **Phase 1 only**.

Deliver:

1. a runnable Shiny for Python app;
2. the three-tab layout;
3. left asset panel;
4. central empty figure canvas;
5. right properties panel;
6. toolbar placeholders;
7. clean project structure;
8. setup/run instructions in `README.md`.

Do not implement quantification, authentication, Supabase, or export yet.

Once the scaffold is stable, proceed to Phase 2.
