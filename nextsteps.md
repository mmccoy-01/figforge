# FigForge — Next Steps

FigForge `0.14.0-beta.1` is a feature-complete public beta candidate for the
focused Upload & Label workflow. The original implementation specification is
archived in [`docs/INITIAL_PRODUCT_SPEC.md`](docs/INITIAL_PRODUCT_SPEC.md).

## Completed beta scope

- [x] Desktop Shiny for Python editor.
- [x] Immutable PNG, JPEG, and TIFF uploads.
- [x] Non-destructive placement, resizing, fitting, cropping, and crop reset.
- [x] Undo/redo for image deletion.
- [x] Uniform guides and structured labels for 1–30 lanes.
- [x] Keyboard cell navigation and spreadsheet paste.
- [x] Horizontal and vertical rectangular merge/unmerge.
- [x] Text, alignment, text/fill color, rotation, border, row-height, and
      border-extension tools.
- [x] Image-independent `.figforge` templates.
- [x] Portable `.figforge` project download and reopen.
- [x] Same-browser IndexedDB refresh/session recovery.
- [x] PNG, TIFF, and PDF publication export at 300 or 600 DPI with tight-content
      and full-canvas bounds.
- [x] Focused hosted UI without Quantification, My Figures, or Save Version.
- [x] Official application artwork and beta documentation.

## Public beta release gate

Complete these checks against the exact Git commit used for the beta tag:

1. [ ] Run the full automated test suite in a clean Python 3.11 environment.
2. [ ] Deploy the candidate commit to Posit Connect Cloud from GitHub.
3. [ ] Complete [`docs/BETA_TESTING.md`](docs/BETA_TESTING.md) at the deployed URL.
4. [ ] Test the supplied complete labeled PNG and at least one representative
       JPEG and TIFF.
5. [ ] Confirm refresh recovery after **Browser recovery saved** appears.
6. [ ] Reopen downloaded image-backed and image-free `.figforge` projects.
7. [ ] Compare every export format and DPI option against its source image.
8. [ ] Verify the app icon, favicon, GitHub link, and README on GitHub.
9. [ ] Review deployment logs and browser console output for uncaught errors.
10. [x] Add the MIT software license before inviting outside reuse or
        contributions.
11. [ ] Create the GitHub prerelease tag `v0.14.0-beta.1` and use the changelog
        entry as the release notes.

## Beta feedback priorities

Address beta feedback in this order:

1. project corruption, missing source assets, or recovery failures;
2. incorrect publication export or crop geometry;
3. label-grid data loss, merge errors, or keyboard regressions;
4. Connect Cloud deployment or session-lifecycle failures;
5. accessibility and cross-browser issues;
6. usability polish and low-risk enhancements.

Every bug fix should include an automated regression test when the affected
behavior can be exercised without a browser. Canvas-interaction fixes should be
rechecked using the manual beta guide.

## Intentionally deferred

These items are not part of the current Connect Cloud beta roadmap:

- quantification;
- user accounts and authentication;
- cloud databases or object storage;
- a shared My Figures library;
- server-side revision history or Save Version;
- collaboration and cross-device live sync;
- individually adjustable internal lane boundaries;
- mobile editing.

The supported persistence model remains same-browser recovery plus user-managed
`.figforge` downloads. Reconsidering any deferred area should begin with a new
product decision rather than being inferred from the archived specification.
