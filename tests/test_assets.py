"""Tests for immutable uploaded asset handling."""

from pathlib import Path

import pytest
from PIL import Image

from figforge.assets import AssetStore, AssetValidationError


def test_png_upload_is_copied_without_changing_bytes(tmp_path: Path) -> None:
    source = tmp_path / "source image.png"
    Image.new("RGB", (37, 19), color=(18, 82, 74)).save(source, format="PNG")
    original_bytes = source.read_bytes()
    store = AssetStore(tmp_path / "assets")

    record = store.import_upload(source, original_filename=r"experiment\gel.png")

    stored = store.root / record.storage_filename
    assert stored.read_bytes() == original_bytes
    assert (record.width, record.height) == (37, 19)
    assert record.filename == "gel.png"
    assert record.mime_type == "image/png"
    assert record.url.startswith("/assets/")


def test_jpeg_uses_format_not_untrusted_extension(tmp_path: Path) -> None:
    source = tmp_path / "looks-like-a-png.png"
    Image.new("RGB", (20, 10), color="white").save(source, format="JPEG")
    store = AssetStore(tmp_path / "assets")

    record = store.import_upload(source, original_filename="blot.png")

    assert record.storage_filename.endswith(".jpg")
    assert record.mime_type == "image/jpeg"


def test_non_image_upload_is_rejected(tmp_path: Path) -> None:
    source = tmp_path / "notes.png"
    source.write_text("not an image", encoding="utf-8")
    store = AssetStore(tmp_path / "assets")

    with pytest.raises(AssetValidationError, match="not a readable image"):
        store.import_upload(source, original_filename=source.name)


def test_16_bit_tiff_keeps_source_and_creates_png_preview(tmp_path: Path) -> None:
    source = tmp_path / "high-dynamic-range.tiff"
    image = Image.new("I;16", (32, 12))
    for y in range(image.height):
        for x in range(image.width):
            image.putpixel((x, y), 1000 + x * 1700 + y * 23)
    image.save(source, format="TIFF")
    original_bytes = source.read_bytes()
    store = AssetStore(tmp_path / "assets")

    record = store.import_upload(source, original_filename="blot_16bit.tiff")

    stored_source = store.root / record.storage_filename
    preview = store.root / str(record.preview_filename)
    assert stored_source.read_bytes() == original_bytes
    assert record.storage_filename.endswith(".tif")
    assert record.mime_type == "image/tiff"
    assert record.source_url.endswith(".tif")
    assert record.url.endswith(".preview.png")
    assert preview.is_file()
    with Image.open(preview) as rendered:
        assert rendered.format == "PNG"
        assert rendered.size == image.size
        assert rendered.getextrema()[0] < rendered.getextrema()[1]
