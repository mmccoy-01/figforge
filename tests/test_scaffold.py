"""Smoke tests for the Phase 1 repository scaffold."""

from pathlib import Path

from figforge.models import SCHEMA_VERSION
from figforge.ui import build_app_ui


ROOT = Path(__file__).resolve().parents[1]


def test_required_phase_one_files_exist() -> None:
    required = (
        "app.py",
        "pyproject.toml",
        "requirements.txt",
        "README.md",
        "figforge/ui/upload_label.py",
        "figforge/ui/quantification.py",
        "figforge/ui/my_figures.py",
        "figforge/persistence.py",
        "figforge/export.py",
        "figforge/static/css/app.css",
        "figforge/static/js/browser_recovery.js",
    )

    assert all((ROOT / path).is_file() for path in required)


def test_three_navigation_labels_are_defined() -> None:
    source = (ROOT / "figforge" / "ui" / "__init__.py").read_text(encoding="utf-8")

    assert "Upload & Label" in source
    assert "Quantification" in source
    assert "My Figures" in source


def test_phase_one_editor_regions_are_present() -> None:
    source = (ROOT / "figforge" / "ui" / "upload_label.py").read_text(encoding="utf-8")

    assert 'aria_label="Project assets"' in source
    assert 'aria_label="Figure canvas"' in source
    assert 'aria_label="Selected object properties"' in source
    assert 'aria_label="Figure editing toolbar"' in source


def test_ui_builds_with_shiny() -> None:
    """Catch invalid Shiny UI calls during collection rather than at launch."""

    rendered = str(build_app_ui())

    assert "Upload &amp; Label" in rendered
    assert "figure_canvas" in rendered
    assert "Quantification is coming later" in rendered
    assert 'id="lane_count"' in rendered
    assert 'max="30"' in rendered
    assert 'id="label_grid_overlay"' in rendered
    assert 'id="add_row_above"' in rendered
    assert 'id="add_row_below"' in rendered
    assert 'id="label_row_name"' in rendered
    assert 'id="label_row_position"' in rendered
    assert 'id="delete_label_row"' in rendered
    assert 'id="label_row_height"' in rendered
    assert 'id="cell_font_size"' in rendered
    assert 'id="cell_rotation"' in rendered
    assert 'id="cell_border_preset"' in rendered
    assert 'id="cell_border_extension"' in rendered
    assert 'id="align_left"' in rendered
    assert 'id="align_center"' in rendered
    assert 'id="align_right"' in rendered
    assert 'id="cell_bold"' in rendered
    assert 'id="cell_italic"' in rendered
    assert 'id="cell_underline"' in rendered
    assert 'id="fill_lane_numbers"' in rendered
    assert 'id="repeat_pattern"' in rendered
    assert 'id="label_action_status"' in rendered
    assert 'id="save_project"' in rendered
    assert 'id="save_version"' in rendered
    assert 'id="export_figure"' in rendered
    assert 'id="download_project"' in rendered
    assert 'id="project_upload"' in rendered
    assert 'id="start_blank_template"' in rendered
    assert 'id="new_project"' in rendered
    assert 'id="project_browser"' in rendered
    assert 'id="revision_browser"' in rendered
    assert 'id="undo_action"' in rendered
    assert 'id="redo_action"' in rendered
    assert 'id="browser_recovery_banner"' in rendered
    assert 'id="restore_browser_draft"' in rendered
    assert 'id="discard_browser_draft"' in rendered
    assert 'id="recovery_upload"' in rendered
    assert 'id="browser_recovery_status"' in rendered


def test_browser_and_server_canvas_schema_versions_match() -> None:
    source = (ROOT / "figforge" / "static" / "js" / "canvas.js").read_text(
        encoding="utf-8"
    )

    assert f"const SCHEMA_VERSION = {SCHEMA_VERSION};" in source
