"""FigForge application entry point.

Run locally with::

    shiny run --reload app.py
"""

from pathlib import Path

from shiny import App, Inputs, Outputs, Session, reactive, render, ui

from figforge.assets import AssetStore, AssetValidationError
from figforge.models import CanvasState
from figforge.ui import build_app_ui


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "data"
ASSET_DIR = DATA_DIR / "assets"
ASSET_STORE = AssetStore(ASSET_DIR)


def server(input: Inputs, output: Outputs, session: Session) -> None:
    """Coordinate immutable uploads and browser-owned canvas state."""

    assets = reactive.value(tuple())
    canvas_state = reactive.value(CanvasState.empty())

    @output
    @render.ui
    def asset_list():
        current_assets = assets()
        if not current_assets:
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
        for record in imported:
            await session.send_custom_message("figforge:add-asset", record.to_client_dict())

    @reactive.effect
    @reactive.event(input.canvas_state, ignore_none=True)
    def receive_canvas_state() -> None:
        try:
            canvas_state.set(CanvasState.from_mapping(input.canvas_state()))
        except (KeyError, TypeError, ValueError):
            # Ignore malformed browser input and retain the last valid state.
            return


app = App(
    build_app_ui(),
    server,
    static_assets={
        "/static": APP_DIR / "figforge" / "static",
        "/assets": ASSET_DIR,
    },
)
