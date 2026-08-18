"""Tests for schema-versioned canvas serialization."""

import pytest

from figforge.models import CanvasState, MAX_LANES, SCHEMA_VERSION


def valid_cell(text: str = "") -> dict:
    return {
        "text": text,
        "colspan": 1,
        "merged_into": None,
        "align": "center",
        "vertical_align": "middle",
        "font_size": 12,
        "bold": False,
        "italic": False,
        "underline": False,
        "rotation": 0,
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


def test_canvas_state_rejects_distorted_zero_sized_image() -> None:
    payload = valid_state()
    payload["images"][0]["width"] = 0

    with pytest.raises(ValueError, match="Displayed image dimensions"):
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


def test_label_cell_formatting_is_validated() -> None:
    payload = valid_state()
    payload["label_rows"][0]["cells"][0]["rotation"] = 45

    with pytest.raises(ValueError, match="rotation must be"):
        CanvasState.from_mapping(payload)
