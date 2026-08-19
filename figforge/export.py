"""High-resolution publication output for FigForge canvas state."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont

from .assets import AssetRecord, AssetStore
from .models import CanvasState, LabelCellState, LabelRowState


SCREEN_DPI = 96
SUPPORTED_DPI = {300, 600}
SUPPORTED_FORMATS = {"png", "tiff", "pdf"}
MAX_OUTPUT_PIXELS = 80_000_000


class FigureExportError(ValueError):
    """Raised when a figure cannot be rendered safely."""


def export_figure(
    state: CanvasState,
    assets: Iterable[AssetRecord],
    asset_store: AssetStore,
    destination: Path,
    *,
    output_format: str,
    dpi: int,
) -> Path:
    """Render a figure to PNG, TIFF, or raster PDF without editing sources."""

    normalized_format = output_format.strip().lower()
    if normalized_format not in SUPPORTED_FORMATS:
        raise FigureExportError("Export format must be PNG, TIFF, or PDF")
    figure = render_figure(state, assets, asset_store, dpi=dpi)
    destination = Path(destination)
    if normalized_format == "png":
        figure.save(destination, format="PNG", dpi=(dpi, dpi), optimize=True)
    elif normalized_format == "tiff":
        figure.save(
            destination,
            format="TIFF",
            dpi=(dpi, dpi),
            compression="tiff_lzw",
        )
    else:
        figure.convert("RGB").save(
            destination,
            format="PDF",
            resolution=dpi,
            quality=95,
        )
    return destination


def render_figure(
    state: CanvasState,
    assets: Iterable[AssetRecord],
    asset_store: AssetStore,
    *,
    dpi: int,
) -> Image.Image:
    """Render images and structured labels; temporary lane guides are omitted."""

    if dpi not in SUPPORTED_DPI:
        raise FigureExportError("Export DPI must be 300 or 600")
    if state.width <= 0 or state.height <= 0:
        raise FigureExportError("The figure canvas has no exportable dimensions")
    if not state.images:
        raise FigureExportError("Add an image before exporting the figure")

    scale = dpi / SCREEN_DPI
    output_width = max(1, round(state.width * scale))
    output_height = max(1, round(state.height * scale))
    if output_width * output_height > MAX_OUTPUT_PIXELS:
        raise FigureExportError(
            "The requested export is too large; reduce the canvas size or use 300 DPI"
        )

    asset_records = {asset.asset_id: asset for asset in assets}
    figure = Image.new("RGBA", (output_width, output_height), "white")
    grids = {grid.image_id: grid for grid in state.lane_grids}

    for image_state in state.images:
        asset = asset_records.get(image_state.asset_id)
        if asset is None:
            raise FigureExportError(f"Missing source asset: {image_state.filename}")
        source_path = asset_store.root / asset.storage_filename
        if not source_path.is_file():
            raise FigureExportError(f"Missing source asset: {image_state.filename}")
        with Image.open(source_path) as source:
            source.seek(0)
            rendered_source = _source_image(source)
            crop = image_state.crop
            crop_left = min(image_state.original_width - 1, max(0, round(crop.x)))
            crop_top = min(image_state.original_height - 1, max(0, round(crop.y)))
            crop_right = min(
                image_state.original_width,
                max(crop_left + 1, round(crop.x + crop.width)),
            )
            crop_bottom = min(
                image_state.original_height,
                max(crop_top + 1, round(crop.y + crop.height)),
            )
            crop_box = (crop_left, crop_top, crop_right, crop_bottom)
            if crop_box != (0, 0, image_state.original_width, image_state.original_height):
                rendered_source = rendered_source.crop(crop_box)
            target_size = (
                max(1, round(image_state.width * scale)),
                max(1, round(image_state.height * scale)),
            )
            if rendered_source.size != target_size:
                rendered_source = rendered_source.resize(
                    target_size, Image.Resampling.LANCZOS
                )
            figure.paste(
                rendered_source,
                (round(image_state.x * scale), round(image_state.y * scale)),
                rendered_source,
            )

    for image_state in state.images:
        grid = grids.get(image_state.image_id)
        if grid is None:
            continue
        _draw_rows_for_image(
            figure,
            state,
            image_state.image_id,
            image_state.x,
            image_state.y,
            image_state.width,
            image_state.height,
            grid.left,
            grid.right,
            scale,
        )

    return figure.convert("RGB")


def _draw_rows_for_image(
    figure: Image.Image,
    state: CanvasState,
    image_id: str,
    image_x: float,
    image_y: float,
    image_width: float,
    image_height: float,
    grid_left: float,
    grid_right: float,
    scale: float,
) -> None:
    rows = [row for row in state.label_rows if row.image_id == image_id]
    above = [row for row in rows if row.position == "above"]
    below = [row for row in rows if row.position == "below"]
    lane_left = image_x + image_width * grid_left
    lane_width = image_width * (grid_right - grid_left)
    positioned_rows: list[tuple[LabelRowState, float]] = []

    above_offset = 6.0
    for row in above:
        above_offset += row.height
        logical_top = image_y - above_offset
        positioned_rows.append((row, logical_top))
        _draw_label_row(
            figure,
            row,
            lane_left,
            logical_top,
            lane_width,
            scale,
        )

    below_offset = 6.0
    for row in below:
        logical_top = image_y + image_height + below_offset
        positioned_rows.append((row, logical_top))
        _draw_label_row(
            figure,
            row,
            lane_left,
            logical_top,
            lane_width,
            scale,
        )
        below_offset += row.height

    _draw_vertical_merged_cells(
        figure,
        rows,
        positioned_rows,
        lane_left,
        lane_width,
        scale,
    )


def _draw_label_row(
    figure: Image.Image,
    row: LabelRowState,
    logical_left: float,
    logical_top: float,
    logical_width: float,
    scale: float,
) -> None:
    lane_count = len(row.cells)
    row_top = round(logical_top * scale)
    row_height = max(1, round(row.height * scale))
    row_left = round(logical_left * scale)
    row_right = round((logical_left + logical_width) * scale)
    row_width = max(1, row_right - row_left)

    name_width = max(1, round(92 * scale))
    name_gap = round(5 * scale)
    name_layer = Image.new("RGBA", (name_width, row_height), (0, 0, 0, 0))
    _draw_text_box(
        name_layer,
        row.name,
        font=_font(max(1, round(10 * scale)), bold=True, italic=False),
        align="right",
        vertical_align="middle",
        color="#102523",
        padding=max(1, round(2 * scale)),
    )
    figure.paste(
        name_layer,
        (row_left - name_gap - name_width, row_top),
        name_layer,
    )

    for column, cell in enumerate(row.cells):
        if cell.merged_into is not None or cell.rowspan > 1:
            continue
        cell_left = round(row_left + row_width * column / lane_count)
        cell_right = round(
            row_left + row_width * (column + cell.colspan) / lane_count
        )
        cell_width = max(1, cell_right - cell_left)
        cell_layer = Image.new("RGBA", (cell_width, row_height), "white")
        _draw_cell(cell_layer, cell, row, column, scale)
        figure.paste(cell_layer, (cell_left, row_top), cell_layer)
        extension = max(0, round(cell.border_extension * scale))
        if extension:
            right_cell = row.cells[column + cell.colspan - 1]
            edges: list[int] = []
            if cell.borders.left:
                edges.append(cell_left)
            if right_cell.borders.right:
                edges.append(cell_right - 1)
            extension_draw = ImageDraw.Draw(figure)
            for edge_x in set(edges):
                if row.position == "above":
                    coordinates = (
                        edge_x,
                        row_top + row_height,
                        edge_x,
                        row_top + row_height + extension,
                    )
                else:
                    coordinates = (
                        edge_x,
                        row_top - extension,
                        edge_x,
                        row_top,
                    )
                extension_draw.line(
                    coordinates,
                    fill="#94a7a4",
                    width=max(1, round(scale)),
                )


def _draw_vertical_merged_cells(
    figure: Image.Image,
    rows: list[LabelRowState],
    positioned_rows: list[tuple[LabelRowState, float]],
    logical_left: float,
    logical_width: float,
    scale: float,
) -> None:
    """Draw rectangular cells that span independently positioned label rows."""

    row_tops = {row.row_id: top for row, top in positioned_rows}
    for row_index, row in enumerate(rows):
        for column, cell in enumerate(row.cells):
            if cell.merged_into is not None or cell.rowspan <= 1:
                continue
            spanned_rows = rows[row_index : row_index + cell.rowspan]
            tops = [row_tops[candidate.row_id] for candidate in spanned_rows]
            logical_top = min(tops)
            logical_bottom = max(
                top + candidate.height
                for candidate, top in zip(spanned_rows, tops, strict=True)
            )
            row_left = round(logical_left * scale)
            row_width = max(1, round(logical_width * scale))
            cell_left = round(
                logical_left * scale + row_width * column / len(row.cells)
            )
            cell_right = round(
                logical_left * scale
                + row_width * (column + cell.colspan) / len(row.cells)
            )
            cell_top = round(logical_top * scale)
            cell_height = max(1, round((logical_bottom - logical_top) * scale))
            cell_layer = Image.new(
                "RGBA",
                (max(1, cell_right - cell_left), cell_height),
                "white",
            )
            _draw_cell(cell_layer, cell, row, column, scale)
            figure.paste(cell_layer, (cell_left, cell_top), cell_layer)

            extension = max(0, round(cell.border_extension * scale))
            if not extension:
                continue
            right_cell = row.cells[column + cell.colspan - 1]
            edges: list[int] = []
            if cell.borders.left:
                edges.append(cell_left)
            if right_cell.borders.right:
                edges.append(cell_right - 1)
            extension_draw = ImageDraw.Draw(figure)
            for edge_x in set(edges):
                if row.position == "above":
                    coordinates = (
                        edge_x,
                        cell_top + cell_height,
                        edge_x,
                        cell_top + cell_height + extension,
                    )
                else:
                    coordinates = (
                        edge_x,
                        cell_top - extension,
                        edge_x,
                        cell_top,
                    )
                extension_draw.line(
                    coordinates,
                    fill="#94a7a4",
                    width=max(1, round(scale)),
                )


def _draw_cell(
    layer: Image.Image,
    cell: LabelCellState,
    row: LabelRowState,
    column: int,
    scale: float,
) -> None:
    draw = ImageDraw.Draw(layer)
    border_width = max(1, round(scale))
    right_border = row.cells[column + cell.colspan - 1].borders.right
    borders = {
        "top": cell.borders.top,
        "right": right_border,
        "bottom": cell.borders.bottom,
        "left": cell.borders.left,
    }
    width, height = layer.size
    color = "#94a7a4"
    if borders["top"]:
        draw.line((0, 0, width, 0), fill=color, width=border_width)
    if borders["right"]:
        draw.line(
            (width - 1, 0, width - 1, height), fill=color, width=border_width
        )
    if borders["bottom"]:
        draw.line(
            (0, height - 1, width, height - 1), fill=color, width=border_width
        )
    if borders["left"]:
        draw.line((0, 0, 0, height), fill=color, width=border_width)

    _draw_text_box(
        layer,
        cell.text,
        font=_font(
            max(1, round(cell.font_size * scale)),
            bold=cell.bold,
            italic=cell.italic,
        ),
        align=cell.align,
        vertical_align=cell.vertical_align,
        color="#102523",
        padding=max(2, round(3 * scale)),
        rotation=cell.rotation,
        underline=cell.underline,
    )


def _draw_text_box(
    layer: Image.Image,
    text: str,
    *,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    align: str,
    vertical_align: str,
    color: str,
    padding: int,
    rotation: int = 0,
    underline: bool = False,
) -> None:
    clean_text = str(text).replace("\r", " ").replace("\n", " ")
    if not clean_text:
        return
    scratch = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    measure = ImageDraw.Draw(scratch)
    left, top, right, bottom = measure.textbbox((0, 0), clean_text, font=font)
    text_width = max(1, right - left)
    text_height = max(1, bottom - top)
    bitmap = Image.new(
        "RGBA", (text_width + padding * 2, text_height + padding * 2), (0, 0, 0, 0)
    )
    bitmap_draw = ImageDraw.Draw(bitmap)
    bitmap_draw.text(
        (padding - left, padding - top), clean_text, font=font, fill=color
    )
    if underline:
        underline_y = min(bitmap.height - 1, padding + text_height + 1)
        bitmap_draw.line(
            (padding, underline_y, padding + text_width, underline_y),
            fill=color,
            width=max(1, padding // 2),
        )
    if rotation == 90:
        bitmap = bitmap.rotate(-90, expand=True, resample=Image.Resampling.BICUBIC)
    elif rotation == -90:
        bitmap = bitmap.rotate(90, expand=True, resample=Image.Resampling.BICUBIC)

    available_width = max(0, layer.width - padding * 2)
    available_height = max(0, layer.height - padding * 2)
    x = {
        "left": padding,
        "center": (layer.width - bitmap.width) // 2,
        "right": layer.width - padding - bitmap.width,
    }.get(align, (layer.width - bitmap.width) // 2)
    y = {
        "top": padding,
        "middle": (layer.height - bitmap.height) // 2,
        "bottom": layer.height - padding - bitmap.height,
    }.get(vertical_align, (layer.height - bitmap.height) // 2)
    if bitmap.width > available_width:
        x = padding
    if bitmap.height > available_height:
        y = padding
    layer.paste(bitmap, (x, y), bitmap)


def _source_image(image: Image.Image) -> Image.Image:
    if image.mode in {"I", "F"} or image.mode.startswith("I;16"):
        low, high = image.getextrema()
        if high <= low:
            return Image.new("RGBA", image.size, color=(0, 0, 0, 255))
        scale = 255 / (high - low)
        return image.point(lambda value: (value - low) * scale).convert("RGBA")
    return image.convert("RGBA")


@lru_cache(maxsize=64)
def _font(
    size: int, *, bold: bool, italic: bool
) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    family = "DejaVuSans"
    suffix = ""
    if bold and italic:
        suffix = "-BoldOblique"
    elif bold:
        suffix = "-Bold"
    elif italic:
        suffix = "-Oblique"
    try:
        return ImageFont.truetype(f"{family}{suffix}.ttf", size=size)
    except OSError:
        return ImageFont.load_default(size=size)


__all__ = [
    "FigureExportError",
    "MAX_OUTPUT_PIXELS",
    "SUPPORTED_DPI",
    "SUPPORTED_FORMATS",
    "export_figure",
    "render_figure",
]
