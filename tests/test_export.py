"""Tests for publication output rendering."""

from pathlib import Path
from copy import deepcopy

import pytest
from PIL import Image

from figforge.assets import AssetRecord, AssetStore
from figforge.export import (
    FigureExportError,
    export_figure,
    figure_export_size,
    render_figure,
)
from figforge.models import CanvasState, SCHEMA_VERSION


def export_fixture(tmp_path: Path) -> tuple[AssetStore, AssetRecord, CanvasState]:
    source = tmp_path / "gel.png"
    Image.new("RGB", (40, 20), color=(205, 20, 25)).save(source, format="PNG")
    store = AssetStore(tmp_path / "assets")
    asset = store.import_upload(source, original_filename="gel.png")
    state = CanvasState.from_mapping(
        {
            "schema_version": SCHEMA_VERSION,
            "canvas": {"width": 96, "height": 80},
            "images": [
                {
                    "image_id": "image_1",
                    "asset_id": asset.asset_id,
                    "filename": asset.filename,
                    "source_url": asset.source_url,
                    "display_url": asset.url,
                    "original_width": 40,
                    "original_height": 20,
                    "x": 10,
                    "y": 20,
                    "width": 40,
                    "height": 20,
                    "rotation": 0,
                }
            ],
            "lane_grids": [
                {
                    "image_id": "image_1",
                    "lane_count": 2,
                    "left": 0,
                    "right": 1,
                    "uniform": True,
                    "boundaries": [],
                    "visible": True,
                    "opacity": 0.8,
                }
            ],
            "label_rows": [
                {
                    "row_id": "row_1",
                    "image_id": "image_1",
                    "name": "Lane",
                    "position": "below",
                    "height": 20,
                    "cells": [
                        {"text": "WT", "font_size": 8},
                        {"text": "KO", "font_size": 8},
                    ],
                }
            ],
        }
    )
    return store, asset, state


def test_png_export_sets_dpi_and_excludes_visible_lane_guides(tmp_path: Path) -> None:
    store, asset, state = export_fixture(tmp_path)
    destination = tmp_path / "figure.png"

    export_figure(state, (asset,), store, destination, output_format="png", dpi=300)

    with Image.open(destination) as exported:
        assert exported.format == "PNG"
        assert exported.size == (300, 250)
        assert exported.info["dpi"] == pytest.approx((300, 300), abs=0.1)
        # A visible guide crosses this source-image pixel on screen. Publication
        # rendering must contain only the red source data at that location.
        red, green, blue = exported.convert("RGB").getpixel((94, 78))
        assert red > 180
        assert green < 40
        assert blue < 40


def test_600_dpi_render_scales_labels_and_canvas(tmp_path: Path) -> None:
    store, asset, state = export_fixture(tmp_path)

    rendered = render_figure(state, (asset,), store, dpi=600)

    assert rendered.size == (600, 500)
    # The label row begins below the image and must contain non-white borders/text.
    label_crop = rendered.crop((60, 285, 315, 420))
    assert any(channel != 255 for channel in label_crop.tobytes())


def test_export_uses_non_destructive_source_crop(tmp_path: Path) -> None:
    source = Image.new("RGB", (40, 20), color=(210, 20, 25))
    source.paste((20, 35, 210), (20, 0, 40, 20))
    source_path = tmp_path / "split.png"
    source.save(source_path, format="PNG")
    store = AssetStore(tmp_path / "crop-assets")
    asset = store.import_upload(source_path, original_filename="split.png")
    _, _, base_state = export_fixture(tmp_path)
    payload = base_state.to_dict()
    image = payload["images"][0]
    image.update(
        {
            "asset_id": asset.asset_id,
            "filename": asset.filename,
            "source_url": asset.source_url,
            "display_url": asset.url,
            "crop": {"x": 20, "y": 0, "width": 20, "height": 20},
        }
    )
    cropped_state = CanvasState.from_mapping(payload)

    rendered = render_figure(cropped_state, (asset,), store, dpi=300)

    red, green, blue = rendered.getpixel((60, 80))
    assert blue > 180
    assert red < 50
    assert green < 60


def test_vertical_cell_border_extension_is_included_in_export(tmp_path: Path) -> None:
    store, asset, state = export_fixture(tmp_path)
    payload = state.to_dict()
    payload["label_rows"][0]["cells"][0]["border_extension"] = 6
    extended_state = CanvasState.from_mapping(payload)

    rendered = render_figure(extended_state, (asset,), store, dpi=300)

    # The below-image row starts at y=46 and its six-pixel extension crosses
    # the otherwise white gap back toward the source image.
    pixel = rendered.getpixel((31, 134))
    assert pixel != (255, 255, 255)
    assert max(pixel) - min(pixel) < 45


def test_cell_fill_and_text_colors_are_included_in_export(tmp_path: Path) -> None:
    store, asset, state = export_fixture(tmp_path)
    payload = state.to_dict()
    cell = payload["label_rows"][0]["cells"][0]
    cell.update(
        {
            "text": "",
            "text_color": "#123456",
            "fill_color": "#f2c94c",
            "borders": {"top": False, "right": False, "bottom": False, "left": False},
        }
    )
    colored_state = CanvasState.from_mapping(payload)

    rendered = render_figure(colored_state, (asset,), store, dpi=300)

    red, green, blue = rendered.getpixel((62, 175))
    assert red > 225
    assert 180 < green < 220
    assert blue < 100


def test_tight_export_removes_unused_canvas_space(tmp_path: Path) -> None:
    store, asset, state = export_fixture(tmp_path)
    destination = tmp_path / "tight.png"

    expected_size = figure_export_size(state, dpi=300, trim_to_content=True)
    export_figure(
        state,
        (asset,),
        store,
        destination,
        output_format="png",
        dpi=300,
        trim_to_content=True,
    )

    with Image.open(destination) as exported:
        assert exported.format == "PNG"
        assert exported.size == expected_size
        assert exported.width < 300
        assert exported.height < 250


def test_vertical_merge_exports_as_one_cell_without_an_internal_row_border(
    tmp_path: Path,
) -> None:
    store, asset, state = export_fixture(tmp_path)
    payload = state.to_dict()
    first_row = payload["label_rows"][0]
    second_row = deepcopy(first_row)
    second_row["row_id"] = "row_2"
    second_row["name"] = "Group"
    first_row["cells"][0]["text"] = ""
    first_row["cells"][0]["rowspan"] = 2
    second_row["cells"][0]["text"] = ""
    second_row["cells"][0]["merged_into"] = 0
    second_row["cells"][0]["merged_into_row"] = "row_1"
    payload["label_rows"].append(second_row)
    merged_state = CanvasState.from_mapping(payload)

    rendered = render_figure(merged_state, (asset,), store, dpi=300)

    # The two 20 px rows meet at logical y=66. A vertical merge must not draw
    # the usual horizontal border through the first lane at that boundary.
    assert rendered.getpixel((62, 206)) == (255, 255, 255)


def test_pdf_and_tiff_exports_are_created(tmp_path: Path) -> None:
    store, asset, state = export_fixture(tmp_path)
    pdf = tmp_path / "figure.pdf"
    tiff = tmp_path / "figure.tiff"

    export_figure(state, (asset,), store, pdf, output_format="pdf", dpi=300)
    export_figure(state, (asset,), store, tiff, output_format="tiff", dpi=600)

    assert pdf.read_bytes().startswith(b"%PDF")
    with Image.open(tiff) as exported_tiff:
        assert exported_tiff.format == "TIFF"
        assert exported_tiff.size == (600, 500)
        assert exported_tiff.info["dpi"] == pytest.approx((600, 600), abs=0.1)


def test_export_rejects_unsupported_dpi(tmp_path: Path) -> None:
    store, asset, state = export_fixture(tmp_path)

    with pytest.raises(FigureExportError, match="300 or 600"):
        render_figure(state, (asset,), store, dpi=1200)
