"""Project browser shell."""

from shiny import ui


def my_figures_panel():
    return ui.tags.section(
        ui.tags.header(
            ui.tags.div(
                ui.tags.p("Project workspace", class_="page-eyebrow"),
                ui.tags.h1("My Figures"),
                ui.tags.p(
                    "Local drafts appear here; cloud deployments use portable project files."
                ),
            ),
            ui.tags.button(
                "+ New figure",
                id="new_project",
                type="button",
                class_="wide-button wide-button--accent new-figure-button",
                title="Start a new blank figure",
            ),
            class_="figures-header",
        ),
        ui.output_ui("project_browser"),
        ui.output_ui("revision_browser"),
        class_="figures-screen",
        aria_label="My Figures project browser",
    )
