"""Serializable FigForge project and canvas models."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping


SCHEMA_VERSION = 5
MAX_LANES = 30
VALID_HORIZONTAL_ALIGNMENTS = {"left", "center", "right"}
VALID_VERTICAL_ALIGNMENTS = {"top", "middle", "bottom"}
VALID_ROTATIONS = {-90, 0, 90}


@dataclass(frozen=True, slots=True)
class ImageTransform:
    """Non-destructive placement of one immutable image asset."""

    image_id: str
    asset_id: str
    filename: str
    source_url: str
    display_url: str
    original_width: int
    original_height: int
    x: float
    y: float
    width: float
    height: float
    rotation: float = 0

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> ImageTransform:
        image = cls(
            image_id=str(value["image_id"]),
            asset_id=str(value["asset_id"]),
            filename=str(value["filename"]),
            source_url=str(value["source_url"]),
            display_url=str(value["display_url"]),
            original_width=int(value["original_width"]),
            original_height=int(value["original_height"]),
            x=float(value["x"]),
            y=float(value["y"]),
            width=float(value["width"]),
            height=float(value["height"]),
            rotation=float(value.get("rotation", 0)),
        )
        if image.original_width <= 0 or image.original_height <= 0:
            raise ValueError("Original image dimensions must be positive")
        if image.width <= 0 or image.height <= 0:
            raise ValueError("Displayed image dimensions must be positive")
        return image


@dataclass(frozen=True, slots=True)
class LaneGridState:
    """Temporary lane guides aligned to one image in normalized coordinates."""

    image_id: str
    lane_count: int
    left: float
    right: float
    uniform: bool
    boundaries: tuple[float, ...]
    visible: bool
    opacity: float

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> LaneGridState:
        grid = cls(
            image_id=str(value["image_id"]),
            lane_count=int(value["lane_count"]),
            left=float(value["left"]),
            right=float(value["right"]),
            uniform=bool(value.get("uniform", True)),
            boundaries=tuple(float(item) for item in value.get("boundaries", ())),
            visible=bool(value.get("visible", False)),
            opacity=float(value.get("opacity", 0.35)),
        )
        if not 1 <= grid.lane_count <= MAX_LANES:
            raise ValueError(f"Lane count must be between 1 and {MAX_LANES}")
        if not 0 <= grid.left < grid.right <= 1:
            raise ValueError("Lane grid bounds must satisfy 0 <= left < right <= 1")
        if not 0 <= grid.opacity <= 1:
            raise ValueError("Lane grid opacity must be between 0 and 1")
        if grid.uniform and grid.boundaries:
            raise ValueError("Uniform lane grids must not contain custom boundaries")
        return grid


@dataclass(frozen=True, slots=True)
class CellBorders:
    """Visible border edges for a label cell."""

    top: bool = True
    right: bool = True
    bottom: bool = True
    left: bool = True

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> CellBorders:
        return cls(
            top=bool(value.get("top", True)),
            right=bool(value.get("right", True)),
            bottom=bool(value.get("bottom", True)),
            left=bool(value.get("left", True)),
        )


@dataclass(frozen=True, slots=True)
class LabelCellState:
    """Editable content, merge metadata, and formatting for one lane."""

    text: str = ""
    colspan: int = 1
    merged_into: int | None = None
    align: str = "center"
    vertical_align: str = "middle"
    font_size: int = 12
    bold: bool = False
    italic: bool = False
    underline: bool = False
    rotation: int = 0
    borders: CellBorders = CellBorders()

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> LabelCellState:
        cell = cls(
            text=str(value.get("text", "")),
            colspan=int(value.get("colspan", 1)),
            merged_into=(
                None if value.get("merged_into") is None else int(value["merged_into"])
            ),
            align=str(value.get("align", "center")),
            vertical_align=str(value.get("vertical_align", "middle")),
            font_size=int(value.get("font_size", 12)),
            bold=bool(value.get("bold", False)),
            italic=bool(value.get("italic", False)),
            underline=bool(value.get("underline", False)),
            rotation=int(value.get("rotation", 0)),
            borders=CellBorders.from_mapping(value.get("borders", {})),
        )
        if cell.colspan < 1 or cell.colspan > MAX_LANES:
            raise ValueError(f"Cell colspan must be between 1 and {MAX_LANES}")
        if cell.align not in VALID_HORIZONTAL_ALIGNMENTS:
            raise ValueError("Cell alignment must be left, center, or right")
        if cell.vertical_align not in VALID_VERTICAL_ALIGNMENTS:
            raise ValueError("Cell vertical alignment must be top, middle, or bottom")
        if not 6 <= cell.font_size <= 72:
            raise ValueError("Cell font size must be between 6 and 72")
        if cell.rotation not in VALID_ROTATIONS:
            raise ValueError("Cell rotation must be -90, 0, or 90 degrees")
        return cell


@dataclass(frozen=True, slots=True)
class LabelRowState:
    """A structured spreadsheet-like label row attached to an image."""

    row_id: str
    image_id: str
    name: str
    position: str
    height: float
    cells: tuple[LabelCellState, ...]

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> LabelRowState:
        row = cls(
            row_id=str(value["row_id"]),
            image_id=str(value["image_id"]),
            name=str(value.get("name", "Label")),
            position=str(value.get("position", "below")),
            height=float(value.get("height", 30)),
            cells=tuple(LabelCellState.from_mapping(cell) for cell in value.get("cells", ())),
        )
        if row.position not in {"above", "below"}:
            raise ValueError("Label row position must be above or below")
        if row.height <= 0:
            raise ValueError("Label row height must be positive")
        if not 1 <= len(row.cells) <= MAX_LANES:
            raise ValueError(f"Label rows must contain between 1 and {MAX_LANES} cells")
        for index, cell in enumerate(row.cells):
            if cell.merged_into is None:
                if index + cell.colspan > len(row.cells):
                    raise ValueError("Merged cell span exceeds its label row")
                for covered_index in range(index + 1, index + cell.colspan):
                    if row.cells[covered_index].merged_into != index:
                        raise ValueError("Merged cell span must reference its anchor")
            else:
                anchor = cell.merged_into
                if anchor < 0 or anchor >= index:
                    raise ValueError("Merged cells must reference a preceding anchor")
                anchor_cell = row.cells[anchor]
                if anchor_cell.merged_into is not None or anchor + anchor_cell.colspan <= index:
                    raise ValueError("Merged cell reference is outside its anchor span")
        return row


@dataclass(frozen=True, slots=True)
class CanvasState:
    """The browser canvas state received through Shiny."""

    schema_version: int
    width: float
    height: float
    images: tuple[ImageTransform, ...]
    lane_grids: tuple[LaneGridState, ...]
    label_rows: tuple[LabelRowState, ...]

    @classmethod
    def empty(cls) -> CanvasState:
        return cls(
            schema_version=SCHEMA_VERSION,
            width=0,
            height=0,
            images=(),
            lane_grids=(),
            label_rows=(),
        )

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> CanvasState:
        schema_version = int(value.get("schema_version", 0))
        if schema_version != SCHEMA_VERSION:
            raise ValueError(f"Unsupported canvas schema version: {schema_version}")

        canvas = value.get("canvas", {})
        images = tuple(ImageTransform.from_mapping(item) for item in value.get("images", ()))
        lane_grids = tuple(
            LaneGridState.from_mapping(item) for item in value.get("lane_grids", ())
        )
        label_rows = tuple(
            LabelRowState.from_mapping(item) for item in value.get("label_rows", ())
        )
        image_ids = {image.image_id for image in images}
        if any(grid.image_id not in image_ids for grid in lane_grids):
            raise ValueError("Every lane grid must reference an existing canvas image")
        if any(row.image_id not in image_ids for row in label_rows):
            raise ValueError("Every label row must reference an existing canvas image")
        lane_counts = {grid.image_id: grid.lane_count for grid in lane_grids}
        if any(
            row.image_id in lane_counts and len(row.cells) != lane_counts[row.image_id]
            for row in label_rows
        ):
            raise ValueError("Label row cell count must match its image lane grid")
        return cls(
            schema_version=schema_version,
            width=float(canvas.get("width", 0)),
            height=float(canvas.get("height", 0)),
            images=images,
            lane_grids=lane_grids,
            label_rows=label_rows,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "canvas": {"width": self.width, "height": self.height},
            "images": [asdict(image) for image in self.images],
            "lane_grids": [
                {**asdict(grid), "boundaries": list(grid.boundaries)}
                for grid in self.lane_grids
            ],
            "label_rows": [
                {
                    **asdict(row),
                    "cells": [
                        {**asdict(cell), "borders": asdict(cell.borders)}
                        for cell in row.cells
                    ],
                }
                for row in self.label_rows
            ],
        }
