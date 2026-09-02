"""FigForge application entry point.

Run locally with::

    shiny run --reload app.py
"""

import os
import re
import tempfile
from datetime import datetime
from pathlib import Path

from shiny import App, Inputs, Outputs, Session, reactive, render, ui

from figforge.assets import AssetStore, AssetValidationError
from figforge.export import (
    FigureExportError,
    export_figure as write_figure_export,
    figure_export_size,
)
from figforge.models import CanvasState
from figforge.persistence import (
    ProjectBundleError,
    ProjectStore,
    create_project_bundle,
    import_project_bundle,
    new_project_id,
    remap_canvas_assets,
)
from figforge.ui import build_app_ui


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "data"
ASSET_DIR = DATA_DIR / "assets"
ASSET_STORE = AssetStore(ASSET_DIR)
STORAGE_MODE = os.getenv("FIGFORGE_STORAGE_MODE", "portable").strip().lower()
if STORAGE_MODE not in {"portable", "local"}:
    raise RuntimeError("FIGFORGE_STORAGE_MODE must be 'portable' or 'local'")
LOCAL_PERSISTENCE = STORAGE_MODE == "local"
PROJECT_STORE = ProjectStore(DATA_DIR / "figforge.db") if LOCAL_PERSISTENCE else None


def server(input: Inputs, output: Outputs, session: Session) -> None:
    """Coordinate immutable uploads and browser-owned canvas state."""

    assets = reactive.value(tuple())
    canvas_state = reactive.value(CanvasState.empty())
    project_id = reactive.value(new_project_id())
    project_name = reactive.value("Untitled figure")
    dirty = reactive.value(False)
    projects_version = reactive.value(0)
    history_project_id = reactive.value(None)
    preview_revision_id = reactive.value(None)
    pending_browser_recovery = reactive.value(None)

    def persist_current_project() -> None:
        if PROJECT_STORE is None:
            dirty.set(False)
            return
        PROJECT_STORE.save_draft(
            project_id(),
            project_name(),
            canvas_state(),
            assets(),
        )
        projects_version.set(projects_version() + 1)
        dirty.set(False)

    def selected_export_format() -> str:
        value = input.export_format()
        return str(value).lower() if value in {"png", "tiff", "pdf"} else "png"

    def selected_export_dpi() -> int:
        try:
            value = int(input.export_dpi() or 300)
        except (TypeError, ValueError):
            return 300
        return value if value in {300, 600} else 300

    def trim_export_to_content() -> bool:
        return input.export_bounds() != "canvas"

    @output
    @render.ui
    def asset_list():
        current_assets = assets()
        if not current_assets:
            if canvas_state().template_frame is not None:
                return ui.tags.div(
                    ui.tags.div("Blank template active", class_="empty-list-title"),
                    ui.tags.p("Upload an image when you are ready to attach it."),
                    class_="asset-empty-state",
                )
            return ui.tags.div(
                ui.tags.div("No images yet", class_="empty-list-title"),
                ui.tags.p("Uploaded PNG, JPEG, and TIFF files will appear here."),
                class_="asset-empty-state",
            )

        return ui.TagList(
            *[
                ui.tags.button(
                    {
                        "data-figforge-asset": "true",
                        "data-asset-id": asset.asset_id,
                        "data-filename": asset.filename,
                        "data-url": asset.url,
                        "data-source-url": asset.source_url,
                        "data-width": str(asset.width),
                        "data-height": str(asset.height),
                    },
                    ui.tags.img(src=asset.url, alt=""),
                    ui.tags.span(
                        ui.tags.span(asset.filename, class_="asset-card-name"),
                        ui.tags.span(
                            f"{asset.width} × {asset.height} px",
                            class_="asset-card-meta",
                        ),
                        class_="asset-card-copy",
                    ),
                    type="button",
                    class_="asset-card",
                    title=f"Add or select {asset.filename}",
                )
                for asset in current_assets
            ]
        )

    @output
    @render.ui
    def project_browser():
        projects_version()
        if PROJECT_STORE is None:
            return ui.tags.div(
                ui.tags.div("↧", class_="placeholder-icon", aria_hidden="true"),
                ui.tags.h2("Portable projects on Connect Cloud"),
                ui.tags.p(
                    "This deployment keeps the active draft only for the current "
                    "session. Use Download project in Upload & Label, then use Open "
                    "project when you return."
                ),
                class_="figures-empty-state",
            )
        projects = PROJECT_STORE.list_projects()
        if not projects:
            return ui.tags.div(
                ui.tags.div("□", class_="placeholder-icon", aria_hidden="true"),
                ui.tags.h2("No saved figures yet"),
                ui.tags.p(
                    "Saved local drafts will appear here. On Connect Cloud, also "
                    "download a portable project copy before ending your session."
                ),
                class_="figures-empty-state",
            )
        return ui.tags.div(
            *[
                ui.tags.article(
                    ui.tags.div(
                        ui.tags.img(src=project.thumbnail_url, alt="")
                        if project.thumbnail_url
                        else ui.tags.span("□", aria_hidden="true"),
                        class_="project-card-thumbnail",
                    ),
                    ui.tags.div(
                        ui.tags.div(
                            ui.tags.div(project.name, class_="project-card-name"),
                            ui.tags.div(
                                f"Edited {_display_timestamp(project.updated_at)}",
                                class_="project-card-time",
                            ),
                            ui.tags.div(
                                f"{project.revision_count} "
                                f"{'version' if project.revision_count == 1 else 'versions'}",
                                class_="project-card-version-count",
                            ),
                        ),
                        ui.tags.div(
                            ui.tags.button(
                                {"data-project-history": project.project_id},
                                "History",
                                type="button",
                                class_="project-history-button",
                                aria_label=f"View history for {project.name}",
                            ),
                            ui.tags.button(
                                {"data-open-project": project.project_id},
                                "Open",
                                type="button",
                                class_="project-open-button",
                                aria_label=f"Open {project.name}",
                            ),
                            class_="project-card-actions",
                        ),
                        class_="project-card-body",
                    ),
                    class_="project-card",
                )
                for project in projects
            ],
            class_="project-browser",
        )

    @output
    @render.ui
    def revision_browser():
        projects_version()
        selected_project_id = history_project_id()
        if PROJECT_STORE is None or not selected_project_id:
            return None
        try:
            project = PROJECT_STORE.load_project(selected_project_id)
            revisions = PROJECT_STORE.list_revisions(selected_project_id)
        except KeyError:
            return None

        selected_revision = None
        if preview_revision_id():
            try:
                selected_revision = PROJECT_STORE.load_revision(
                    selected_project_id, preview_revision_id()
                )
            except KeyError:
                selected_revision = None

        return ui.tags.section(
            ui.tags.header(
                ui.tags.div(
                    ui.tags.p("Version history", class_="page-eyebrow"),
                    ui.tags.h2(project.name),
                    ui.tags.p(
                        "Checkpoints are immutable. Restoring creates a new version."
                    ),
                ),
                ui.tags.button(
                    {"data-close-history": "true"},
                    "Close",
                    type="button",
                    class_="revision-close-button",
                    aria_label="Close version history",
                ),
                class_="revision-browser-header",
            ),
            (
                ui.tags.div(
                    ui.tags.div(
                        *[
                            ui.tags.button(
                                {
                                    "data-preview-revision": revision.revision_id,
                                    "data-project-id": selected_project_id,
                                    "aria-current": (
                                        "true"
                                        if selected_revision
                                        and selected_revision.revision_id
                                        == revision.revision_id
                                        else "false"
                                    ),
                                },
                                ui.tags.span(
                                    f"v{revision.version_number}",
                                    class_="revision-version",
                                ),
                                ui.tags.span(
                                    revision.note or "Saved version",
                                    class_="revision-note",
                                ),
                                ui.tags.time(
                                    _display_timestamp(revision.created_at),
                                    class_="revision-time",
                                ),
                                type="button",
                                class_="revision-list-item",
                            )
                            for revision in revisions
                        ],
                        class_="revision-list",
                        aria_label="Saved versions",
                    ),
                    _revision_preview_ui(selected_revision)
                    if selected_revision
                    else ui.tags.div(
                        "Choose a version to preview it.",
                        class_="revision-preview-empty",
                    ),
                    class_="revision-browser-body",
                )
                if revisions
                else ui.tags.div(
                    ui.tags.h3("No versions saved yet"),
                    ui.tags.p(
                        "Open this project and choose Save Version to create a checkpoint."
                    ),
                    class_="revision-empty-state",
                )
            ),
            class_="revision-browser-panel",
            aria_label=f"Version history for {project.name}",
        )

    @reactive.effect
    @reactive.event(input.image_upload, ignore_none=True)
    async def store_uploaded_images() -> None:
        uploaded_files = input.image_upload()
        if not uploaded_files:
            return

        imported = []
        for uploaded in uploaded_files:
            try:
                record = ASSET_STORE.import_upload(
                    Path(uploaded["datapath"]),
                    original_filename=uploaded["name"],
                )
            except AssetValidationError as exc:
                ui.notification_show(str(exc), type="error", duration=6)
                continue
            imported.append(record)

        if not imported:
            return

        assets.set((*assets(), *imported))
        dirty.set(True)
        for record in imported:
            await session.send_custom_message("figforge:add-asset", record.to_client_dict())

    @reactive.effect
    @reactive.event(input.browser_recovery_request, ignore_none=True)
    async def prepare_browser_recovery() -> None:
        payload = input.browser_recovery_request()
        try:
            if not isinstance(payload, dict):
                raise ValueError("Browser recovery data is invalid")
            if payload.get("format") != "figforge-browser-draft":
                raise ValueError("Browser recovery data is invalid")
            if int(payload.get("recovery_version", 0)) != 1:
                raise ValueError("Browser recovery version is unsupported")
            recovered_state = CanvasState.from_mapping(payload.get("state", {}))
            asset_entries = payload.get("assets") or []
            if isinstance(asset_entries, dict):
                asset_entries = list(asset_entries.values())
            if not isinstance(asset_entries, (list, tuple)) or len(asset_entries) > 100:
                raise ValueError("Browser recovery asset list is invalid")
            asset_metadata = {
                str(entry.get("asset_id")): {
                    "filename": str(entry.get("filename", "image")),
                    "mime_type": str(entry.get("mime_type", "application/octet-stream")),
                }
                for entry in asset_entries
                if isinstance(entry, dict) and entry.get("asset_id")
            }
            required_ids = tuple(dict.fromkeys(image.asset_id for image in recovered_state.images))
            if any(asset_id not in asset_metadata for asset_id in required_ids):
                raise ValueError("Browser recovery is missing image metadata")
        except (KeyError, TypeError, ValueError) as exc:
            await session.send_custom_message(
                "figforge:recovery-error", {"message": str(exc)}
            )
            return

        recovery = {
            "name": str(payload.get("name", "Untitled figure")).strip()
            or "Untitled figure",
            "state": recovered_state,
            "asset_metadata": asset_metadata,
            "required_ids": required_ids,
        }
        pending_browser_recovery.set(recovery)
        if required_ids:
            await session.send_custom_message(
                "figforge:recovery-ready", {"asset_ids": list(required_ids)}
            )
            return
        await finish_browser_recovery(recovery, {})

    async def finish_browser_recovery(recovery, remapped_assets) -> None:
        try:
            recovered_state = remap_canvas_assets(
                recovery["state"], remapped_assets
            )
        except (KeyError, ProjectBundleError, TypeError, ValueError) as exc:
            for record in remapped_assets.values():
                ASSET_STORE.delete(record)
            pending_browser_recovery.set(None)
            await session.send_custom_message(
                "figforge:recovery-error", {"message": str(exc)}
            )
            return

        recovered_assets = tuple(remapped_assets.values())
        project_id.set(new_project_id())
        project_name.set(recovery["name"])
        canvas_state.set(recovered_state)
        assets.set(recovered_assets)
        dirty.set(False)
        pending_browser_recovery.set(None)
        await session.send_custom_message(
            "figforge:load-project",
            {
                "name": recovery["name"],
                "state": recovered_state.to_dict(),
                "assets": [asset.to_client_dict() for asset in recovered_assets],
            },
        )
        await session.send_custom_message(
            "figforge:recovery-complete", {"label": "Browser draft recovered"}
        )
        ui.notification_show(
            "Recovered the latest draft saved by this browser",
            type="message",
            duration=5,
        )

    @reactive.effect
    @reactive.event(input.recovery_upload, ignore_none=True)
    async def restore_browser_assets() -> None:
        uploaded_files = input.recovery_upload()
        recovery = pending_browser_recovery()
        if not uploaded_files or not recovery:
            return

        imported = {}
        try:
            for uploaded in uploaded_files:
                match = re.fullmatch(
                    r"ffrecover-([A-Za-z0-9_-]{1,128})\.(?:png|jpe?g|tiff?)",
                    str(uploaded["name"]),
                    flags=re.IGNORECASE,
                )
                if match is None:
                    raise ValueError("Browser recovery received an unexpected file")
                old_asset_id = match.group(1)
                metadata = recovery["asset_metadata"].get(old_asset_id)
                if metadata is None or old_asset_id in imported:
                    raise ValueError("Browser recovery image identifiers are invalid")
                imported[old_asset_id] = ASSET_STORE.import_upload(
                    Path(uploaded["datapath"]),
                    original_filename=metadata["filename"],
                )
            if set(imported) != set(recovery["required_ids"]):
                raise ValueError("Browser recovery did not receive every source image")
        except (AssetValidationError, KeyError, TypeError, ValueError) as exc:
            for record in imported.values():
                ASSET_STORE.delete(record)
            pending_browser_recovery.set(None)
            await session.send_custom_message(
                "figforge:recovery-error", {"message": str(exc)}
            )
            return

        await finish_browser_recovery(recovery, imported)

    @reactive.effect
    @reactive.event(input.canvas_state, ignore_none=True)
    def receive_canvas_state() -> None:
        try:
            canvas_state.set(CanvasState.from_mapping(input.canvas_state()))
            dirty.set(True)
        except (KeyError, TypeError, ValueError):
            # Ignore malformed browser input and retain the last valid state.
            return

    @reactive.effect
    @reactive.event(input.project_name_change, ignore_none=True)
    def receive_project_name() -> None:
        value = input.project_name_change()
        if isinstance(value, dict):
            value = value.get("value", "")
        project_name.set(str(value).strip() or "Untitled figure")
        dirty.set(True)

    @reactive.effect
    async def autosave_project() -> None:
        reactive.invalidate_later(2)
        state = canvas_state()
        if not dirty() or (not state.images and state.template_frame is None):
            return
        persist_current_project()
        await session.send_custom_message(
            "figforge:save-status",
            {
                "label": "Saved" if LOCAL_PERSISTENCE else "Session draft",
                "state": "saved",
            },
        )

    @reactive.effect
    @reactive.event(input.save_project_request, ignore_none=True)
    async def save_project() -> None:
        persist_current_project()
        await session.send_custom_message(
            "figforge:save-status",
            {
                "label": "Saved" if LOCAL_PERSISTENCE else "Session draft",
                "state": "saved",
            },
        )
        ui.notification_show(
            "Project saved locally"
            if LOCAL_PERSISTENCE
            else "Session draft saved. Download the project for a durable copy.",
            type="message",
            duration=5 if not LOCAL_PERSISTENCE else 3,
        )

    @reactive.effect
    @reactive.event(input.export_figure_request, ignore_none=True)
    def prompt_export_figure() -> None:
        if not canvas_state().images:
            ui.notification_show(
                "Attach an image before exporting the figure.", type="error", duration=4
            )
            return
        ui.modal_show(
            ui.modal(
                ui.tags.div(
                    ui.input_select(
                        "export_format",
                        "Format",
                        {"png": "PNG", "tiff": "TIFF", "pdf": "PDF"},
                        selected="png",
                    ),
                    ui.input_radio_buttons(
                        "export_dpi",
                        "Resolution",
                        {"300": "300 DPI", "600": "600 DPI"},
                        selected="300",
                        inline=True,
                    ),
                    ui.input_radio_buttons(
                        "export_bounds",
                        "Area",
                        {
                            "tight": "Tight content",
                            "canvas": "Full canvas",
                        },
                        selected="tight",
                        inline=True,
                    ),
                    class_="export-option-grid",
                ),
                ui.tags.div(
                    ui.tags.strong("Clean publication output"),
                    ui.tags.p(
                        "Temporary lane guides, selection outlines, and resize "
                        "handles are always excluded. Tight content removes unused "
                        "canvas space. This downloads an image, not a .figforge project."
                    ),
                    class_="export-clean-note",
                ),
                ui.tags.div(
                    ui.output_text("export_dimensions"),
                    class_="export-dimensions",
                    aria_live="polite",
                ),
                ui.download_button(
                    "download_figure",
                    "Download PNG image",
                    class_="wide-button wide-button--accent export-download-button",
                ),
                title="Export Figure",
                easy_close=True,
                footer=ui.modal_button("Close"),
            )
        )

    @reactive.effect
    @reactive.event(input.open_project_request, ignore_none=True)
    async def open_project() -> None:
        if PROJECT_STORE is None:
            ui.notification_show(
                "Use Open project to reopen a downloaded .figforge file.",
                type="message",
            )
            return
        requested = input.open_project_request()
        requested_id = requested.get("project_id") if isinstance(requested, dict) else requested
        try:
            project = PROJECT_STORE.load_project(str(requested_id))
        except KeyError:
            ui.notification_show("That local project is no longer available", type="error")
            return
        project_id.set(project.project_id)
        project_name.set(project.name)
        canvas_state.set(project.state)
        assets.set(project.assets)
        dirty.set(False)
        await session.send_custom_message(
            "figforge:load-project",
            {
                "name": project.name,
                "state": project.state.to_dict(),
                "assets": [asset.to_client_dict() for asset in project.assets],
            },
        )

    @reactive.effect
    @reactive.event(input.new_project_request, ignore_none=True)
    async def new_project() -> None:
        project_id.set(new_project_id())
        project_name.set("Untitled figure")
        canvas_state.set(CanvasState.empty())
        assets.set(tuple())
        dirty.set(False)
        await session.send_custom_message(
            "figforge:load-project",
            {"name": "Untitled figure", "state": CanvasState.empty().to_dict(), "assets": []},
        )

    @reactive.effect
    @reactive.event(input.project_upload, ignore_none=True)
    async def open_portable_project() -> None:
        uploaded = input.project_upload()
        if not uploaded:
            return
        try:
            name, state, imported_assets = import_project_bundle(
                Path(uploaded[0]["datapath"]), ASSET_STORE
            )
        except ProjectBundleError as exc:
            ui.notification_show(str(exc), type="error", duration=6)
            return
        project_id.set(new_project_id())
        project_name.set(name)
        canvas_state.set(state)
        assets.set(imported_assets)
        if LOCAL_PERSISTENCE:
            persist_current_project()
        else:
            dirty.set(False)
        await session.send_custom_message(
            "figforge:load-project",
            {
                "name": name,
                "state": state.to_dict(),
                "assets": [asset.to_client_dict() for asset in imported_assets],
            },
        )
        ui.notification_show("Portable project opened", type="message", duration=4)

    @output
    @render.text
    def export_dimensions():
        dpi = selected_export_dpi()
        state = canvas_state()
        width, height = figure_export_size(
            state,
            dpi=dpi,
            trim_to_content=trim_export_to_content(),
        )
        return f"Output: {width:,} × {height:,} px at {dpi} DPI"

    @output
    @render.download_button(
        filename=lambda: (
            f"{_safe_download_name(project_name())}.{selected_export_format()}"
        ),
        media_type=lambda: {
            "png": "image/png",
            "tiff": "image/tiff",
            "pdf": "application/pdf",
        }[selected_export_format()],
    )
    def download_figure():
        output_format = selected_export_format()
        dpi = selected_export_dpi()
        with tempfile.TemporaryDirectory(prefix="figforge-figure-export-") as temporary:
            destination = Path(temporary) / f"figure.{output_format}"
            try:
                write_figure_export(
                    canvas_state(),
                    assets(),
                    ASSET_STORE,
                    destination,
                    output_format=output_format,
                    dpi=dpi,
                    trim_to_content=trim_export_to_content(),
                )
            except FigureExportError as exc:
                ui.notification_show(str(exc), type="error", duration=6)
                return
            yield destination.read_bytes()

    @output
    @render.download_button(
        filename=lambda: f"{_safe_download_name(project_name())}.figforge",
        media_type="application/zip",
    )
    def download_project():
        with tempfile.TemporaryDirectory(prefix="figforge-export-") as temporary:
            bundle = Path(temporary) / "project.figforge"
            create_project_bundle(
                project_name(), canvas_state(), assets(), ASSET_STORE, bundle
            )
            yield bundle.read_bytes()


app = App(
    build_app_ui(),
    server,
    static_assets={
        "/static": APP_DIR / "figforge" / "static",
        "/assets": ASSET_DIR,
    },
)


def _display_timestamp(value: str) -> str:
    try:
        return datetime.fromisoformat(value).astimezone().strftime("%b %d, %Y %I:%M %p")
    except ValueError:
        return value


def _safe_download_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-.")
    return cleaned or "untitled-figure"


def _revision_preview_ui(revision):
    state = revision.state
    first_image = state.images[0] if state.images else None
    preview_surface_id = (
        first_image.image_id
        if first_image
        else state.template_frame.image_id
        if state.template_frame
        else None
    )
    rows = (
        [row for row in state.label_rows if row.image_id == preview_surface_id]
        if preview_surface_id
        else []
    )
    lane_count = len(rows[0].cells) if rows else 0
    if first_image:
        grid = next(
            (item for item in state.lane_grids if item.image_id == first_image.image_id),
            None,
        )
        if grid:
            lane_count = grid.lane_count

    label_preview = (
        ui.tags.div(
            *[
                ui.tags.div(
                    ui.tags.div(row.name, class_="revision-label-name"),
                    *[
                        ui.tags.span(
                            cell.text or " ",
                            class_="revision-label-cell",
                            style=f"--cell-span: {cell.colspan}",
                        )
                        for cell in row.cells
                        if cell.merged_into is None
                    ],
                    class_="revision-label-row",
                    style=(
                        f"grid-template-columns: 92px repeat({lane_count}, "
                        "minmax(30px, 1fr))"
                    ),
                )
                for row in rows
            ],
            class_="revision-label-grid",
        )
        if rows
        else ui.tags.p("No label rows in this version.", class_="revision-preview-note")
    )

    return ui.tags.article(
        ui.tags.header(
            ui.tags.div(
                ui.tags.span(
                    f"v{revision.version_number}", class_="revision-preview-version"
                ),
                ui.tags.h3(revision.note or "Saved version"),
                ui.tags.time(_display_timestamp(revision.created_at)),
            ),
            ui.tags.span("Read-only preview", class_="revision-readonly-badge"),
            class_="revision-preview-header",
        ),
        ui.tags.div(
            (
                ui.tags.img(src=first_image.display_url, alt=first_image.filename)
                if first_image
                else ui.tags.div("No image", class_="revision-preview-no-image")
            ),
            class_="revision-preview-image",
        ),
        ui.tags.div(
            ui.tags.span(
                f"{len(state.images)} {'image' if len(state.images) == 1 else 'images'}"
            ),
            ui.tags.span(
                f"{lane_count} {'lane' if lane_count == 1 else 'lanes'}"
                if lane_count
                else "No lane grid"
            ),
            ui.tags.span(
                f"{len(state.label_rows)} "
                f"{'label row' if len(state.label_rows) == 1 else 'label rows'}"
            ),
            class_="revision-preview-metrics",
        ),
        label_preview,
        ui.tags.div(
            ui.tags.p(
                "Restoring leaves every newer version intact and creates a new head."
            ),
            ui.tags.button(
                {
                    "data-restore-revision": revision.revision_id,
                    "data-project-id": revision.project_id,
                },
                f"Restore v{revision.version_number}",
                type="button",
                class_="revision-restore-button",
            ),
            class_="revision-preview-footer",
        ),
        class_="revision-preview",
    )
