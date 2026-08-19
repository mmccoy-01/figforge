"""UI composition for FigForge."""

from pathlib import Path

from shiny import ui

from .upload_label import upload_label_panel


def build_app_ui():
    """Build the top-level FigForge application shell."""

    css_path = Path(__file__).resolve().parents[1] / "static" / "css" / "app.css"

    return ui.page_fillable(
        ui.tags.head(
            ui.tags.title("FigForge"),
            ui.tags.link(
                rel="icon",
                type="image/png",
                href="/static/img/figforge-icon.png",
            ),
            ui.include_css(css_path),
            ui.tags.script(src="/static/js/browser_recovery.js", defer=True),
            ui.tags.script(src="/static/js/canvas.js", defer=True),
        ),
        ui.tags.div(
            ui.tags.header(
                ui.tags.div(
                    ui.tags.img(
                            src="/static/img/figforge-icon.png",
                        alt="",
                        class_="brand-mark",
                        aria_hidden="true",
                    ),
                    ui.tags.div(
                        ui.tags.div("FigForge", class_="brand-name"),
                        ui.tags.div("Scientific figure workspace", class_="brand-tagline"),
                    ),
                    class_="brand-lockup",
                ),
                ui.tags.div(
                    _header_button("Save", "save_project", primary=True),
                    _header_button("New", "new_project"),
                    _header_button("Export", "export_figure"),
                    ui.tags.a(
                        ui.HTML(
                            '<svg viewBox="0 0 24 24" aria-hidden="true" '
                            'focusable="false" class="github-mark"><path d="'
                            'M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56'
                            'v-2.22c-3.22.7-3.9-1.36-3.9-1.36-.53-1.35-1.3-1.71-1.3-1.71'
                            '-1.06-.73.08-.72.08-.72 1.17.08 1.79 1.2 1.79 1.2 1.04 1.78'
                            ' 2.73 1.27 3.4.97.1-.75.4-1.27.73-1.56-2.57-.29-5.27-1.28'
                            '-5.27-5.69 0-1.26.44-2.29 1.2-3.1-.12-.3-.52-1.48.11-3.08'
                            ' 0 0 .98-.31 3.2 1.18a11.1 11.1 0 0 1 5.82 0c2.22-1.49'
                            ' 3.2-1.18 3.2-1.18.63 1.6.23 2.78.11 3.08.76.81 1.2'
                            ' 1.84 1.2 3.1 0 4.42-2.71 5.39-5.29 5.68.41.35.77 1.03.77'
                            ' 2.08v3.08c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z"/>'
                            '</svg>'
                        ),
                        href="https://github.com/mmccoy-01/figforge",
                        target="_blank",
                        rel="noopener noreferrer",
                        class_="header-repo-link",
                        aria_label="View FigForge source code on GitHub",
                        title="View the FigForge source repository",
                    ),
                    class_="header-actions",
                    aria_label="Project actions",
                ),
                class_="app-header",
            ),
            ui.tags.main(
                upload_label_panel(),
                class_="app-content",
            ),
            class_="app-shell",
        ),
        fillable=True,
    )


def _header_button(label: str, element_id: str, *, primary: bool = False):
    style_class = "header-button header-button--primary" if primary else "header-button"
    available = element_id in {"save_project", "new_project", "export_figure"}
    return ui.tags.button(
        label,
        id=element_id,
        type="button",
        class_=style_class,
        disabled=not available,
        title=(
            "Save the current draft"
            if element_id == "save_project"
            else "Start a new blank project"
            if element_id == "new_project"
            else "Export a publication-ready PNG, TIFF, or PDF"
            if element_id == "export_figure"
            else f"{label} will be enabled in a later milestone"
        ),
    )


__all__ = ["build_app_ui"]
