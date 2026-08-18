"""Local project browser shell."""

from shiny import ui


def my_figures_panel():
    return ui.tags.section(
        ui.tags.header(
            ui.tags.div(
                ui.tags.p("Local workspace", class_="page-eyebrow"),
                ui.tags.h1("My Figures"),
                ui.tags.p("Saved projects will be available here on this computer."),
            ),
            ui.tags.button(
                "+ New figure",
                type="button",
                class_="wide-button wide-button--accent new-figure-button",
                disabled=True,
                title="Project creation is part of the persistence milestone",
            ),
            class_="figures-header",
        ),
        ui.tags.div(
            ui.tags.div("□", class_="placeholder-icon", aria_hidden="true"),
            ui.tags.h2("No saved figures yet"),
            ui.tags.p("Your local projects, previews, and recent edit times will appear here."),
            class_="figures-empty-state",
        ),
        class_="figures-screen",
        aria_label="My Figures project browser",
    )
