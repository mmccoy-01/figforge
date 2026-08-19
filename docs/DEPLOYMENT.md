# Deployment and persistence

## Posit Connect Cloud

FigForge is structured for repository-based Shiny for Python deployment. The
repository root contains the required `app.py` entry point and `requirements.txt`.

1. Push the complete repository to GitHub, including `figforge/static/`.
2. Sign in to Posit Connect Cloud and choose **Publish**.
3. Select the GitHub repository and branch.
4. Select Shiny for Python and set the primary file to `app.py`.
5. Choose whether pushes to the branch should automatically republish the app.
6. Publish and review the build and runtime logs.

The current official workflow is described in Posit's
[New publish guide](https://docs.posit.co/connect-cloud/user/publish/01-new.html)
and [Shiny for Python guide](https://docs.posit.co/connect-cloud/how-to/python/shiny-python.html).

### Storage mode

FigForge defaults to portable-project mode. No database or storage environment
variable is required for Connect Cloud. The equivalent explicit setting is:

```text
FIGFORGE_STORAGE_MODE=portable
```

Portable mode does not present runtime disk as permanent user storage. Users
work in the live Shiny session, receive same-browser IndexedDB recovery, and
download `.figforge` checkpoints for durable storage and cross-device transfer.

Set `FIGFORGE_STORAGE_MODE=local` only for a trusted, single-user installation
whose `data/` directory is genuinely persistent. Do not use it to imply durable
storage on an ephemeral hosted worker.

### Timeout behavior

Connect Cloud can close inactive browser connections and shut down worker
processes with no active connections. These are configurable content settings;
the platform defaults can change. See Posit's
[compute and connection settings](https://docs.posit.co/connect-cloud/user/manage/content_settings.html)
for the current controls.

FigForge recovery does not depend on the old worker surviving. When the browser
has reported **Browser recovery saved**, a refresh can start a new Shiny session
and offer **Restore draft** from that same browser profile and deployment URL.
Always keep downloaded `.figforge` checkpoints because browser storage can still
be cleared or evicted.

## Posit Cloud is a different product

Posit Cloud code projects are browser-hosted development workspaces. Their
dashboard **Export** action downloads the code project as a ZIP, as described in
the [Posit Cloud project guide](https://docs.posit.co/cloud/guide/projects.html#project-actions).
That ZIP is a backup of the development project; it is not an emergency export
of an individual FigForge user's in-progress browser draft.

For users of a deployed FigForge app, **Download project** is the relevant backup
action and produces a `.figforge` file.

## Beta deployment verification

After every beta deployment:

- confirm that the official icon, CSS, and JavaScript load;
- upload PNG, JPEG, and TIFF test files;
- create and reopen both image-backed and image-free `.figforge` projects;
- refresh after the recovery indicator reports success and restore the draft;
- export PNG, TIFF, and PDF at both 300 and 600 DPI;
- verify that temporary guides and editing controls are absent from exports;
- review the deployment logs for warnings or unhandled errors;
- verify the header GitHub link and the public visibility setting.

Use synthetic test images for public beta verification.
