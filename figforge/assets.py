"""Immutable local storage for uploaded scientific images."""

from __future__ import annotations

import shutil
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, UnidentifiedImageError


class AssetValidationError(ValueError):
    """Raised when an upload is not a supported, readable image."""


@dataclass(frozen=True, slots=True)
class AssetRecord:
    asset_id: str
    filename: str
    storage_filename: str
    width: int
    height: int
    mime_type: str
    created_at: str
    preview_filename: str | None = None

    @property
    def source_url(self) -> str:
        """URL of the immutable uploaded source file."""

        return f"/assets/{self.storage_filename}"

    @property
    def url(self) -> str:
        """Browser-renderable URL, using a derivative preview when required."""

        filename = self.preview_filename or self.storage_filename
        return f"/assets/{filename}"

    def to_client_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["url"] = self.url
        payload["source_url"] = self.source_url
        return payload


class AssetStore:
    """Copy validated uploads into an immutable, ID-addressed directory."""

    _FORMATS = {
        "PNG": (".png", "image/png"),
        "JPEG": (".jpg", "image/jpeg"),
        "TIFF": (".tif", "image/tiff"),
    }
    _MAX_PREVIEW_SIZE = (4096, 4096)

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def import_upload(
        self,
        source: Path,
        *,
        original_filename: str,
    ) -> AssetRecord:
        """Validate and copy an upload without modifying its bytes."""

        try:
            with Image.open(source) as image:
                image_format = image.format
                width, height = image.size
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise AssetValidationError("The selected file is not a readable image") from exc

        if image_format not in self._FORMATS:
            raise AssetValidationError("FigForge currently accepts PNG, JPEG, and TIFF images")
        if width <= 0 or height <= 0:
            raise AssetValidationError("The selected image has invalid dimensions")

        extension, mime_type = self._FORMATS[image_format]
        asset_id = uuid.uuid4().hex
        storage_filename = f"{asset_id}{extension}"
        destination = self.root / storage_filename
        preview_filename = f"{asset_id}.preview.png" if image_format == "TIFF" else None
        preview_destination = self.root / preview_filename if preview_filename else None

        try:
            shutil.copyfile(source, destination)
            if preview_destination is not None:
                self._create_tiff_preview(source, preview_destination)
        except (OSError, ValueError) as exc:
            destination.unlink(missing_ok=True)
            if preview_destination is not None:
                preview_destination.unlink(missing_ok=True)
            raise AssetValidationError("FigForge could not create a display preview") from exc

        return AssetRecord(
            asset_id=asset_id,
            filename=Path(original_filename.replace("\\", "/")).name,
            storage_filename=storage_filename,
            width=width,
            height=height,
            mime_type=mime_type,
            created_at=datetime.now(timezone.utc).isoformat(),
            preview_filename=preview_filename,
        )

    def _create_tiff_preview(self, source: Path, destination: Path) -> None:
        """Render the first TIFF frame to PNG without changing the source."""

        with Image.open(source) as image:
            image.seek(0)
            preview = self._browser_image(image)
            preview.thumbnail(self._MAX_PREVIEW_SIZE, Image.Resampling.LANCZOS)
            preview.save(destination, format="PNG", optimize=True)

    @staticmethod
    def _browser_image(image: Image.Image) -> Image.Image:
        """Convert Pillow modes unsupported by browsers into an 8-bit preview."""

        if image.mode in {"I", "F"} or image.mode.startswith("I;16"):
            low, high = image.getextrema()
            if high <= low:
                return Image.new("L", image.size, color=0)
            scale = 255 / (high - low)
            # Pillow evaluates point transforms symbolically for I/F modes, so
            # keep this expression linear. Values are bounded by the extrema.
            normalized = image.point(lambda value: (value - low) * scale)
            return normalized.convert("L")
        if image.mode in {"1", "L", "LA", "P", "RGB", "RGBA", "CMYK"}:
            return image.convert("RGBA" if "A" in image.mode or image.mode == "P" else "RGB")
        return image.convert("RGB")
