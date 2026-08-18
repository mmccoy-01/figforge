"""UI composition for FigForge."""

from pathlib import Path

from shiny import ui

from .my_figures import my_figures_panel
from .quantification import quantification_panel
from .upload_label import upload_label_panel


def build_app_ui():
    """Build the top-level FigForge application shell."""

    css_path = Path(__file__).resolve().parents[1] / "static" / "css" / "app.css"

    return ui.page_fillable(
        ui.tags.head(
            ui.tags.title("FigForge"),
            ui.include_css(css_path),
            ui.tags.script(src="/static/js/browser_recovery.js", defer=True),
            ui.tags.script(src="/static/js/canvas.js", defer=True),
        ),
        ui.tags.div(
            ui.tags.header(
                ui.tags.div(
                    ui.tags.div("F", class_="brand-mark", aria_hidden="true"),
                    ui.tags.div(
                        ui.tags.div("FigForge", class_="brand-name"),
                        ui.tags.div("Scientific figure workspace", class_="brand-tagline"),
                    ),
                    class_="brand-lockup",
                ),
                ui.tags.div(
                    _header_button("Save", "save_project", primary=True),
                    _header_button("Save Version", "save_version"),
                    _header_button("Export", "export_figure"),
                    class_="header-actions",
                    aria_label="Project actions",
                ),
                class_="app-header",
            ),
            ui.tags.main(
                ui.navset_tab(
                    ui.nav_panel("Upload & Label", upload_label_panel(), value="editor"),
                    ui.nav_panel(
                        "Quantification",
                        quantification_panel(),
                        value="quantification",
                    ),
                    ui.nav_panel("My Figures", my_figures_panel(), value="figures"),
                    id="primary_navigation",
                    selected="editor",
                ),
                class_="app-content",
            ),
            class_="app-shell",
        ),
        fillable=True,
    )


def _header_button(label: str, element_id: str, *, primary: bool = False):
    style_class = "header-button header-button--primary" if primary else "header-button"
    available = element_id in {"save_project", "save_version", "export_figure"}
    return ui.tags.button(
        label,
        id=element_id,
        type="button",
        class_=style_class,
        disabled=not available,
        title=(
            "Save the current draft"
            if element_id == "save_project"
            else (
                "Create an immutable local version checkpoint"
                if element_id == "save_version"
                else (
                    "Export a publication-ready PNG, TIFF, or PDF"
                    if element_id == "export_figure"
                    else f"{label} will be enabled in a later milestone"
                )
            )
        ),
    )


__all__ = ["build_app_ui"]
