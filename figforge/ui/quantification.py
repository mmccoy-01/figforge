"""Quantification screen placeholder."""

from shiny import ui


def quantification_panel():
    return ui.tags.section(
        ui.tags.div(
            ui.tags.div("∿", class_="placeholder-icon", aria_hidden="true"),
            ui.tags.p("Future workspace", class_="placeholder-eyebrow"),
            ui.tags.h1("Quantification is coming later"),
            ui.tags.p(
                "FigForge will focus first on fast labeling, layout, and reliable "
                "project persistence before adding lane and band analysis."
            ),
            ui.tags.span("Intentionally deferred", class_="status-chip"),
            class_="placeholder-card",
        ),
        class_="placeholder-screen",
        aria_label="Quantification placeholder",
    )
