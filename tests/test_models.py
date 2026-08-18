"""Tests for schema-versioned canvas serialization."""

import pytest

from figforge.models import CanvasState, MAX_LANES, SCHEMA_VERSION


def valid_cell(text: str = "") -> dict:
    return {
        "text": text,
        "colspan": 1,
        "rowspan": 1,
        "merged_into": None,
        "merged_into_row": None,
        "align": "center",
        "vertical_align": "middle",
        "font_size": 12,
        "bold": False,
        "italic": False,
        "underline": False,
        "rotation": 0,
        "border_extension": 0.0,
        "borders": {"top": True, "right": True, "bottom": True, "left": True},
    }


def valid_state() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "canvas": {"width": 800, "height": 500},
        "images": [
            {
                "image_id": "image_1",
                "asset_id": "asset_1",
                "filename": "gel.png",
                "source_url": "/assets/asset_1.png",
                "display_url": "/assets/asset_1.preview.png",
                "original_width": 1200,
                "original_height": 300,
                "x": 40,
                "y": 80,
                "width": 600,
                "height": 150,
                "rotation": 0,
            }
        ],
        "template_frame": None,
        "lane_grids": [
            {
                "image_id": "image_1",
                "lane_count": 23,
                "left": 0.05,
                "right": 0.95,
                "uniform": True,
                "boundaries": [],
                "visible": True,
                "opacity": 0.35,
            }
        ],
        "label_rows": [
            {
                "row_id": "row_1",
                "image_id": "image_1",
                "name": "Rat ID",
                "position": "below",
                "height": 30,
                "cells": [valid_cell(str(index + 1)) for index in range(23)],
            }
        ],
    }


def test_canvas_state_round_trip() -> None:
    state = CanvasState.from_mapping(valid_state())

    assert state.to_dict() == valid_state()


def test_canvas_state_rejects_unknown_schema_version() -> None:
    payload = valid_state()
    payload["schema_version"] = 999

    with pytest.raises(ValueError, match="Unsupported canvas schema version"):
        CanvasState.from_mapping(payload)


def test_schema_five_projects_migrate_border_extensions_to_zero() -> None:
    payload = valid_state()
    payload["schema_version"] = 5
    for row in payload["label_rows"]:
        for cell in row["cells"]:
            cell.pop("border_extension")
            cell.pop("rowspan")
            cell.pop("merged_into_row")

    state = CanvasState.from_mapping(payload)

    assert state.schema_version == SCHEMA_VERSION
    assert state.label_rows[0].cells[0].border_extension == 0
    assert state.label_rows[0].cells[0].rowspan == 1
    assert state.to_dict()["label_rows"][0]["cells"][0]["border_extension"] == 0


def test_canvas_state_rejects_distorted_zero_sized_image() -> None:
    payload = valid_state()
    payload["images"][0]["width"] = 0

    with pytest.raises(ValueError, match="Displayed image dimensions"):
        CanvasState.from_mapping(payload)


def test_image_independent_template_frame_is_valid() -> None:
    payload = valid_state()
    payload["images"] = []
    payload["template_frame"] = {
        "image_id": "template_1",
        "x": 40,
        "y": 80,
        "width": 600,
        "height": 150,
    }
    payload["lane_grids"][0]["image_id"] = "template_1"
    payload["label_rows"][0]["image_id"] = "template_1"

    state = CanvasState.from_mapping(payload)

    assert state.images == ()
    assert state.template_frame is not None
    assert state.template_frame.image_id == "template_1"
    assert state.to_dict() == payload


def test_template_frame_cannot_coexist_with_an_attached_image() -> None:
    payload = valid_state()
    payload["template_frame"] = {
        "image_id": "template_1",
        "x": 40,
        "y": 80,
        "width": 600,
        "height": 150,
    }

    with pytest.raises(ValueError, match="cannot coexist"):
        CanvasState.from_mapping(payload)


def test_lane_count_is_capped_at_thirty() -> None:
    payload = valid_state()
    payload["lane_grids"][0]["lane_count"] = MAX_LANES + 1

    with pytest.raises(ValueError, match="Lane count must be between 1 and 30"):
        CanvasState.from_mapping(payload)


def test_lane_grid_uses_valid_normalized_bounds() -> None:
    payload = valid_state()
    payload["lane_grids"][0]["left"] = 0.9
    payload["lane_grids"][0]["right"] = 0.4

    with pytest.raises(ValueError, match="Lane grid bounds"):
        CanvasState.from_mapping(payload)


def test_label_row_cell_count_matches_lane_grid() -> None:
    payload = valid_state()
    payload["label_rows"][0]["cells"].pop()

    with pytest.raises(ValueError, match="cell count must match"):
        CanvasState.from_mapping(payload)


def test_label_row_position_is_validated() -> None:
    payload = valid_state()
    payload["label_rows"][0]["position"] = "floating"

    with pytest.raises(ValueError, match="position must be above or below"):
        CanvasState.from_mapping(payload)


def test_merged_cells_round_trip_without_discarding_covered_content() -> None:
    payload = valid_state()
    cells = payload["label_rows"][0]["cells"]
    cells[0]["colspan"] = 3
    cells[1]["merged_into"] = 0
    cells[2]["merged_into"] = 0

    state = CanvasState.from_mapping(payload)

    assert state.to_dict() == payload
    assert state.label_rows[0].cells[1].text == "2"


def test_merged_cell_span_requires_matching_covered_cells() -> None:
    payload = valid_state()
    payload["label_rows"][0]["cells"][0]["colspan"] = 2

    with pytest.raises(ValueError, match="must reference its anchor"):
        CanvasState.from_mapping(payload)


def test_vertical_merged_cells_round_trip() -> None:
    payload = valid_state()
    second_row = {
        **payload["label_rows"][0],
        "row_id": "row_2",
        "name": "Condition",
        "cells": [valid_cell(f"C{index + 1}") for index in range(23)],
    }
    payload["label_rows"].append(second_row)
    anchor = payload["label_rows"][0]["cells"][2]
    anchor["colspan"] = 2
    anchor["rowspan"] = 2
    for row_index in range(2):
        for column in range(2, 4):
            if row_index == 0 and column == 2:
                continue
            covered = payload["label_rows"][row_index]["cells"][column]
            covered["merged_into"] = 2
            covered["merged_into_row"] = "row_1"

    state = CanvasState.from_mapping(payload)

    assert state.to_dict() == payload
    assert state.label_rows[0].cells[2].rowspan == 2


def test_vertical_merge_cannot_cross_above_and_below_rows() -> None:
    payload = valid_state()
    second_row = {
        **payload["label_rows"][0],
        "row_id": "row_2",
        "position": "above",
        "cells": [valid_cell() for _ in range(23)],
    }
    payload["label_rows"].append(second_row)
    payload["label_rows"][0]["cells"][0]["rowspan"] = 2
    payload["label_rows"][1]["cells"][0]["merged_into"] = 0
    payload["label_rows"][1]["cells"][0]["merged_into_row"] = "row_1"

    with pytest.raises(ValueError, match="one label position"):
        CanvasState.from_mapping(payload)


def test_label_cell_formatting_is_validated() -> None:
    payload = valid_state()
    payload["label_rows"][0]["cells"][0]["rotation"] = 45

    with pytest.raises(ValueError, match="rotation must be"):
        CanvasState.from_mapping(payload)


def test_border_extension_is_bounded() -> None:
    payload = valid_state()
    payload["label_rows"][0]["cells"][0]["border_extension"] = 501

    with pytest.raises(ValueError, match="border extension"):
        CanvasState.from_mapping(payload)
