"""Upload & Label editor shell."""

from shiny import ui


def upload_label_panel():
    """Return the three-column figure editing workspace."""

    return ui.tags.section(
        ui.tags.section(
            ui.tags.div(
                ui.tags.strong("Browser recovery is available"),
                ui.tags.span(id="browser_recovery_description"),
                class_="browser-recovery-copy",
            ),
            ui.tags.div(
                ui.tags.button(
                    "Restore draft",
                    id="restore_browser_draft",
                    type="button",
                    class_="lane-action lane-action--primary",
                ),
                ui.tags.button(
                    "Discard",
                    id="discard_browser_draft",
                    type="button",
                    class_="lane-action",
                ),
                class_="browser-recovery-actions",
            ),
            id="browser_recovery_banner",
            class_="browser-recovery-banner is-hidden",
            role="status",
            aria_live="polite",
        ),
        ui.tags.div(
            ui.input_file(
                "recovery_upload",
                "",
                multiple=True,
                accept=[".png", ".jpg", ".jpeg", ".tif", ".tiff"],
            ),
            class_="browser-recovery-upload",
            aria_hidden="true",
        ),
        ui.tags.div(
            _asset_panel(),
            _canvas_panel(),
            _properties_panel(),
            class_="editor-grid",
        ),
        _toolbar(),
        class_="editor-screen",
        aria_label="Upload and label workspace",
    )


def _asset_panel():
    return ui.tags.aside(
        _panel_header("Project / Assets", "Source images stay unchanged"),
        ui.tags.div(
            ui.tags.label("Figure name", for_="figure_name", class_="field-label"),
            ui.tags.input(
                id="figure_name",
                type="text",
                value="Untitled figure",
                class_="text-field",
            ),
            class_="field-group",
        ),
        ui.tags.div(
            ui.tags.div("Images", class_="section-label"),
            ui.output_ui("asset_list"),
            class_="asset-list-region",
        ),
        ui.tags.div(
            ui.input_file(
                "image_upload",
                "",
                multiple=True,
                accept=[
                    "image/png",
                    "image/jpeg",
                    "image/tiff",
                    ".png",
                    ".jpg",
                    ".jpeg",
                    ".tif",
                    ".tiff",
                ],
                button_label="+ Upload images",
                placeholder="PNG, JPEG, or TIFF",
            ),
            ui.tags.button(
                "Start without image",
                id="start_blank_template",
                type="button",
                class_="wide-button blank-template-button",
                title="Create a lane and label template before attaching an image",
            ),
            class_="upload-control",
        ),
        ui.tags.div(
            ui.tags.div("Project file", class_="section-label"),
            ui.tags.p(
                "Download a project or reusable template, with or without an image.",
                class_="portable-project-help",
            ),
            ui.tags.div(
                ui.download_button(
                    "download_project",
                    "Download project",
                    class_="wide-button portable-download",
                ),
                ui.tags.div(
                    ui.input_file(
                        "project_upload",
                        "",
                        multiple=False,
                        accept=[".figforge", "application/zip"],
                        button_label="Open project",
                        placeholder=".figforge",
                    ),
                    class_="upload-control project-upload-control",
                ),
                class_="portable-project-actions",
            ),
            ui.tags.div(
                "Browser recovery initializes after the first edit",
                id="browser_recovery_status",
                class_="browser-recovery-status",
                role="status",
                aria_live="polite",
            ),
            class_="portable-project",
        ),
        class_="side-panel asset-panel",
        aria_label="Project assets",
    )


def _canvas_panel():
    return ui.tags.section(
        ui.tags.div(
            ui.tags.div(
                ui.tags.span("100%", class_="zoom-value"),
                ui.tags.button(
                    "Fit",
                    id="fit_image",
                    type="button",
                    class_="canvas-control",
                    disabled=True,
                    title="Fit the selected image within the canvas",
                ),
                class_="canvas-controls",
            ),
            class_="canvas-header",
        ),
        ui.tags.div(
            ui.tags.div(
                ui.tags.div("▧", class_="canvas-empty-icon", aria_hidden="true"),
                ui.tags.h2("Your figure canvas is ready"),
                ui.tags.p("Upload an image or start a blank template."),
                ui.tags.span("PNG, JPEG, TIFF, or template", class_="status-chip"),
                class_="canvas-empty-state",
                id="canvas_empty_state",
            ),
            ui.tags.canvas(
                id="figure_stage",
                tabindex="0",
                aria_label="Interactive image editing surface",
            ),
            ui.tags.div(
                id="label_grid_overlay",
                class_="label-grid-overlay",
                aria_label="Lane-aligned label rows",
            ),
            id="figure_canvas",
            class_="figure-canvas",
            role="region",
            aria_label="Figure canvas",
        ),
        class_="canvas-panel",
    )


def _properties_panel():
    return ui.tags.aside(
        _panel_header("Properties", "Nothing selected", subtitle_id="selected_object_label"),
        ui.tags.div(
            _property_group(
                "Position & Size",
                ui.tags.div(
                    _compact_fields(
                        ("X", "prop_x"),
                        ("Y", "prop_y"),
                        ("W", "prop_width"),
                        ("H", "prop_height"),
                    ),
                    ui.tags.button(
                        "Reset crop",
                        id="reset_crop",
                        type="button",
                        class_="lane-action reset-crop-button",
                        disabled=True,
                        title="Restore the complete immutable source image",
                    ),
                    ui.tags.p(
                        "Crop changes only the visible source region; the uploaded image stays unchanged.",
                        class_="lane-guide-help crop-help",
                    ),
                    class_="property-stack",
                ),
            ),
            _property_group("Lane Guides", _lane_guide_controls()),
            _property_group("Label Rows", _label_row_controls()),
            _property_group("Productivity", _productivity_controls()),
            _property_group(
                "Alignment",
                ui.tags.div(
                    *[_icon_button(symbol, label, element_id) for symbol, label, element_id in (
                        ("⇤", "Align left", "align_left"),
                        ("↔", "Align center", "align_center"),
                        ("⇥", "Align right", "align_right"),
                    )],
                    class_="button-cluster",
                ),
            ),
            _property_group(
                "Text",
                ui.tags.div(
                    ui.tags.label(
                        ui.tags.span("Font size", class_="visually-hidden"),
                        ui.tags.select(
                            *[
                                ui.tags.option(
                                    f"{size} pt",
                                    value=str(size),
                                    selected=size == 12,
                                )
                                for size in (8, 9, 10, 11, 12, 14, 16, 18, 24, 32)
                            ],
                            id="cell_font_size",
                            disabled=True,
                            aria_label="Font size",
                        ),
                        class_="select-placeholder",
                    ),
                    ui.tags.div(
                        _icon_button("B", "Bold", "cell_bold", "text-bold"),
                        _icon_button("I", "Italic", "cell_italic", "text-italic"),
                        _icon_button("U", "Underline", "cell_underline", "text-underline"),
                        class_="button-cluster",
                    ),
                    ui.tags.label(
                        ui.tags.span("Text rotation", class_="visually-hidden"),
                        ui.tags.select(
                            ui.tags.option("Horizontal", value="0", selected=True),
                            ui.tags.option("Rotate 90°", value="90"),
                            ui.tags.option("Rotate -90°", value="-90"),
                            id="cell_rotation",
                            disabled=True,
                            aria_label="Text rotation",
                        ),
                        class_="select-placeholder",
                    ),
                    class_="property-stack",
                ),
            ),
            _property_group(
                "Borders",
                ui.tags.div(
                    ui.tags.label(
                        ui.tags.span("Border preset", class_="visually-hidden"),
                        ui.tags.select(
                            ui.tags.option("All borders", value="all", selected=True),
                            ui.tags.option("No borders", value="none"),
                            ui.tags.option("Outer border", value="outer"),
                            ui.tags.option("Top border", value="top"),
                            ui.tags.option("Bottom border", value="bottom"),
                            ui.tags.option("Left border", value="left"),
                            ui.tags.option("Right border", value="right"),
                            ui.tags.option("Custom", value="custom", disabled=True),
                            id="cell_border_preset",
                            disabled=True,
                            aria_label="Border preset",
                        ),
                        class_="select-placeholder",
                    ),
                    ui.tags.label(
                        ui.tags.span("Extend toward image (px)"),
                        ui.tags.input(
                            id="cell_border_extension",
                            type="number",
                            min="0",
                            max="500",
                            step="1",
                            value="0",
                            disabled=True,
                            aria_label="Vertical border extension length",
                        ),
                        class_="label-row-field border-extension-field",
                    ),
                    ui.tags.p(
                        "Projects selected left/right borders toward the image.",
                        class_="lane-guide-help",
                    ),
                    class_="property-stack",
                ),
            ),
            class_="properties-body",
        ),
        ui.tags.div(
            ui.tags.span("Select an image to inspect its non-destructive transform."),
            class_="properties-hint",
        ),
        class_="side-panel properties-panel",
        aria_label="Selected object properties",
    )


def _toolbar():
    tools = (
        ("↖", "Select", "select_tool", False),
        ("⌗", "Crop", "crop_tool", True),
        ("＋", "Add Row", "add_row", True),
        ("▭", "Merge", "merge_cells", True),
        ("▦", "Borders", "cell_borders", True),
        ("↻", "Rotate", "rotate_object", True),
        ("⌫", "Delete", "delete_image", True),
    )
    return ui.tags.footer(
        ui.tags.div(
            *[
                ui.tags.button(
                    ui.tags.span(icon, class_="tool-icon", aria_hidden="true"),
                    ui.tags.span(label),
                    id=element_id,
                    type="button",
                    class_="tool-button tool-button--active" if not disabled else "tool-button",
                    disabled=disabled,
                    title=f"{label} selected" if not disabled else f"{label} is not available yet",
                )
                for icon, label, element_id, disabled in tools
            ],
            class_="tool-group",
        ),
        ui.tags.div(class_="toolbar-divider", aria_hidden="true"),
        ui.tags.div(
            ui.tags.button(
                "↶ Undo",
                id="undo_action",
                type="button",
                class_="history-button",
                disabled=True,
                title="Undo (Ctrl/Cmd+Z)",
            ),
            ui.tags.button(
                "↷ Redo",
                id="redo_action",
                type="button",
                class_="history-button",
                disabled=True,
                title="Redo (Ctrl/Cmd+Shift+Z)",
            ),
            class_="history-group",
        ),
        ui.tags.div(
            ui.tags.span(class_="save-indicator-dot", aria_hidden="true"),
            ui.tags.span("Draft", class_="save-indicator-label"),
            class_="save-indicator",
        ),
        class_="editor-toolbar",
        aria_label="Figure editing toolbar",
    )


def _panel_header(title: str, subtitle: str, subtitle_id: str | None = None):
    return ui.tags.header(
        ui.tags.div(title, class_="panel-eyebrow"),
        ui.tags.div(subtitle, id=subtitle_id, class_="panel-subtitle"),
        class_="panel-header",
    )


def _property_group(title: str, content):
    return ui.tags.section(
        ui.tags.h3(title),
        content,
        class_="property-group",
    )


def _lane_guide_controls():
    return ui.tags.div(
        ui.tags.div(
            ui.tags.label("Lanes", for_="lane_count"),
            ui.tags.input(
                id="lane_count",
                type="number",
                min="1",
                max="30",
                step="1",
                value="30",
                disabled=True,
            ),
            ui.tags.span("Maximum 30", class_="lane-limit-note"),
            class_="lane-count-control",
        ),
        ui.tags.div(
            ui.tags.button(
                "Show lane guides",
                id="toggle_lane_guides",
                type="button",
                class_="lane-action lane-action--primary",
                disabled=True,
            ),
            ui.tags.button(
                "Reset",
                id="reset_lane_grid",
                type="button",
                class_="lane-action",
                disabled=True,
            ),
            class_="lane-actions",
        ),
        ui.tags.label(
            ui.tags.span("Guide opacity"),
            ui.tags.output("35%", id="lane_opacity_value"),
            class_="lane-opacity-label",
        ),
        ui.tags.input(
            id="lane_opacity",
            type="range",
            min="0.1",
            max="0.8",
            step="0.05",
            value="0.35",
            disabled=True,
            aria_label="Guide opacity",
        ),
        ui.tags.div(
            ui.tags.span("Lane region"),
            ui.tags.output("—", id="lane_bounds_value"),
            class_="lane-bounds-label",
        ),
        ui.tags.label(
            ui.tags.input(
                id="uniform_lanes",
                type="checkbox",
                checked=True,
                disabled=True,
            ),
            ui.tags.span("Uniform lane widths"),
            class_="lane-uniform-control",
            title="Individual lane boundaries are planned for a later milestone",
        ),
        ui.tags.p(
            "Drag the stronger left and right guide edges to align the grid. "
            "The scientific image is never stretched. On a blank template, "
            "changing the lane count adapts patterns, formatting, and merged groups.",
            class_="lane-guide-help",
        ),
        class_="lane-guide-controls",
    )


def _label_row_controls():
    return ui.tags.div(
        ui.tags.div(
            ui.tags.button(
                "+ Above",
                id="add_row_above",
                type="button",
                class_="lane-action",
                disabled=True,
            ),
            ui.tags.button(
                "+ Below",
                id="add_row_below",
                type="button",
                class_="lane-action lane-action--primary",
                disabled=True,
            ),
            class_="label-row-add-actions",
        ),
        ui.tags.label(
            ui.tags.span("Row name"),
            ui.tags.input(
                id="label_row_name",
                type="text",
                value="",
                placeholder="Select a row",
                disabled=True,
            ),
            class_="label-row-field",
        ),
        ui.tags.label(
            ui.tags.span("Position"),
            ui.tags.select(
                ui.tags.option("Above image", value="above"),
                ui.tags.option("Below image", value="below", selected=True),
                id="label_row_position",
                disabled=True,
            ),
            class_="label-row-field",
        ),
        ui.tags.label(
            ui.tags.span("Height"),
            ui.tags.input(
                id="label_row_height",
                type="number",
                min="20",
                max="120",
                step="2",
                value="30",
                disabled=True,
                aria_label="Row height",
            ),
            class_="label-row-field",
        ),
        ui.tags.button(
            "Delete selected row",
            id="delete_label_row",
            type="button",
            class_="lane-action label-row-delete",
            disabled=True,
        ),
        ui.tags.p(
            "Click a cell to select it. Press Enter or start typing to edit; use "
            "Tab and arrow keys to move between cells.",
            class_="lane-guide-help",
        ),
        class_="label-row-controls",
    )


def _compact_fields(*fields: tuple[str, str]):
    return ui.tags.div(
        *[
            ui.tags.label(
                ui.tags.span(label),
                ui.tags.input(id=element_id, type="text", value="—", readonly=True),
            )
            for label, element_id in fields
        ],
        class_="compact-fields",
    )


def _productivity_controls():
    return ui.tags.div(
        ui.tags.div(
            ui.tags.button(
                "Fill lane numbers",
                id="fill_lane_numbers",
                type="button",
                class_="lane-action",
                disabled=True,
            ),
            ui.tags.button(
                "Repeat pattern",
                id="repeat_pattern",
                type="button",
                class_="lane-action lane-action--primary",
                disabled=True,
            ),
            class_="productivity-actions",
        ),
        ui.tags.p(
            "Copy cells from Excel or Google Sheets, select a starting cell, then paste. "
            "New rows are added when multiline data needs them.",
            class_="lane-guide-help",
        ),
        ui.tags.div(
            "Select a cell to use labeling helpers.",
            id="label_action_status",
            class_="label-action-status",
            role="status",
            aria_live="polite",
        ),
        class_="productivity-controls",
    )


def _icon_button(
    symbol: str,
    label: str,
    element_id: str | None = None,
    extra_class: str = "",
):
    return ui.tags.button(
        symbol,
        id=element_id,
        type="button",
        class_=f"icon-button {extra_class}".strip(),
        disabled=True,
        aria_label=label,
        title=label,
    )


def _select_placeholder(label: str, value: str):
    return ui.tags.label(
        ui.tags.span(label, class_="visually-hidden"),
        ui.tags.select(
            ui.tags.option(value),
            disabled=True,
            aria_label=label,
        ),
        class_="select-placeholder",
    )
