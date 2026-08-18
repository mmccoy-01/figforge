"""Tests for local drafts and portable project bundles."""

from pathlib import Path

import pytest
from PIL import Image

from figforge.assets import AssetRecord, AssetStore
from figforge.models import CanvasState, SCHEMA_VERSION
from figforge.persistence import (
    ProjectBundleError,
    ProjectStore,
    create_project_bundle,
    import_project_bundle,
    new_project_id,
    remap_canvas_assets,
)


def canvas_state(asset: AssetRecord, label: str = "WT") -> CanvasState:
    return CanvasState.from_mapping(
        {
            "schema_version": SCHEMA_VERSION,
            "canvas": {"width": 800, "height": 500},
            "images": [
                {
                    "image_id": "image_1",
                    "asset_id": asset.asset_id,
                    "filename": asset.filename,
                    "source_url": asset.source_url,
                    "display_url": asset.url,
                    "original_width": asset.width,
                    "original_height": asset.height,
                    "x": 80,
                    "y": 120,
                    "width": 400,
                    "height": 200,
                    "rotation": 0,
                }
            ],
            "lane_grids": [
                {
                    "image_id": "image_1",
                    "lane_count": 2,
                    "left": 0.05,
                    "right": 0.95,
                    "uniform": True,
                    "boundaries": [],
                    "visible": False,
                    "opacity": 0.35,
                }
            ],
            "label_rows": [
                {
                    "row_id": "row_1",
                    "image_id": "image_1",
                    "name": "Genotype",
                    "position": "below",
                    "height": 30,
                    "cells": [{"text": label}, {"text": "KO"}],
                }
            ],
        }
    )


def template_state() -> CanvasState:
    return CanvasState.from_mapping(
        {
            "schema_version": SCHEMA_VERSION,
            "canvas": {"width": 800, "height": 500},
            "images": [],
            "template_frame": {
                "image_id": "template_1",
                "x": 80,
                "y": 120,
                "width": 400,
                "height": 200,
            },
            "lane_grids": [
                {
                    "image_id": "template_1",
                    "lane_count": 2,
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
                    "image_id": "template_1",
                    "name": "Genotype",
                    "position": "below",
                    "height": 30,
                    "cells": [{"text": "WT"}, {"text": "KO"}],
                }
            ],
        }
    )


def imported_png(tmp_path: Path, store_name: str = "assets") -> tuple[AssetStore, AssetRecord, bytes]:
    source = tmp_path / f"{store_name}.png"
    Image.new("RGB", (40, 20), color=(14, 65, 58)).save(source, format="PNG")
    original = source.read_bytes()
    store = AssetStore(tmp_path / store_name)
    return store, store.import_upload(source, original_filename="gel.png"), original


def test_project_draft_round_trip_and_autosave_update(tmp_path: Path) -> None:
    asset_store, asset, _ = imported_png(tmp_path)
    project_store = ProjectStore(tmp_path / "figforge.db")
    project_id = new_project_id()
    first_state = canvas_state(asset)

    project_store.save_draft(project_id, "First name", first_state, (asset,))
    updated_state = canvas_state(asset, label="Mutant")
    project_store.save_draft(project_id, "Updated name", updated_state, (asset,))

    projects = project_store.list_projects()
    loaded = project_store.load_project(project_id)
    assert len(projects) == 1
    assert projects[0].name == "Updated name"
    assert projects[0].thumbnail_url == asset.url
    assert loaded.name == "Updated name"
    assert loaded.state == updated_state
    assert loaded.assets == (asset,)


def test_portable_bundle_reopens_with_remapped_immutable_asset(tmp_path: Path) -> None:
    source_store, asset, original = imported_png(tmp_path, "source-assets")
    state = canvas_state(asset)
    bundle = tmp_path / "experiment.figforge"

    create_project_bundle("Experiment 7", state, (asset,), source_store, bundle)
    destination_store = AssetStore(tmp_path / "destination-assets")
    name, reopened_state, reopened_assets = import_project_bundle(bundle, destination_store)

    assert name == "Experiment 7"
    assert reopened_assets[0].asset_id != asset.asset_id
    assert reopened_state.images[0].asset_id == reopened_assets[0].asset_id
    assert reopened_state.images[0].source_url == reopened_assets[0].source_url
    assert (destination_store.root / reopened_assets[0].storage_filename).read_bytes() == original
    assert reopened_state.label_rows[0].cells[0].text == "WT"


def test_browser_recovery_remaps_expired_asset_urls(tmp_path: Path) -> None:
    _, expired_asset, _ = imported_png(tmp_path, "expired-assets")
    _, recovered_asset, _ = imported_png(tmp_path, "recovered-assets")

    recovered_state = remap_canvas_assets(
        canvas_state(expired_asset), {expired_asset.asset_id: recovered_asset}
    )

    assert recovered_state.images[0].image_id == "image_1"
    assert recovered_state.images[0].asset_id == recovered_asset.asset_id
    assert recovered_state.images[0].filename == recovered_asset.filename
    assert recovered_state.images[0].source_url == recovered_asset.source_url
    assert recovered_state.images[0].display_url == recovered_asset.url
    assert recovered_state.label_rows[0].cells[0].text == "WT"


def test_browser_recovery_rejects_missing_source_asset(tmp_path: Path) -> None:
    _, expired_asset, _ = imported_png(tmp_path, "expired-assets")

    with pytest.raises(ProjectBundleError, match="missing a source image"):
        remap_canvas_assets(canvas_state(expired_asset), {})


def test_image_independent_template_bundle_round_trip(tmp_path: Path) -> None:
    state = template_state()
    bundle = tmp_path / "blank-template.figforge"
    source_store = AssetStore(tmp_path / "source-assets")

    create_project_bundle("Two-lane template", state, (), source_store, bundle)
    name, reopened_state, reopened_assets = import_project_bundle(
        bundle, AssetStore(tmp_path / "destination-assets")
    )

    assert name == "Two-lane template"
    assert reopened_assets == ()
    assert reopened_state == state
    assert reopened_state.template_frame is not None
    assert reopened_state.label_rows[0].name == "Genotype"


def test_local_store_accepts_template_without_assets(tmp_path: Path) -> None:
    project_store = ProjectStore(tmp_path / "figforge.db")
    project_id = new_project_id()

    project_store.save_draft(project_id, "Blank template", template_state(), ())
    loaded = project_store.load_project(project_id)

    assert loaded.assets == ()
    assert loaded.state.template_frame is not None


def test_invalid_portable_bundle_is_rejected(tmp_path: Path) -> None:
    invalid = tmp_path / "invalid.figforge"
    invalid.write_text("not a zip", encoding="utf-8")

    with pytest.raises(ProjectBundleError, match="could not open"):
        import_project_bundle(invalid, AssetStore(tmp_path / "assets"))


def test_revision_history_is_immutable_and_restore_creates_new_head(
    tmp_path: Path,
) -> None:
    _, asset, _ = imported_png(tmp_path)
    project_store = ProjectStore(tmp_path / "figforge.db")
    project_id = new_project_id()

    project_store.save_draft(project_id, "Revision test", canvas_state(asset), (asset,))
    version_one = project_store.create_revision(project_id, "Original labels")
    project_store.save_draft(
        project_id,
        "Revision test",
        canvas_state(asset, label="Mutant"),
        (asset,),
    )
    version_two = project_store.create_revision(project_id, "Changed genotype")

    history = project_store.list_revisions(project_id)
    historical = project_store.load_revision(project_id, version_one.revision_id)
    restored = project_store.restore_revision(project_id, version_one.revision_id)
    restored_history = project_store.list_revisions(project_id)

    assert [revision.version_number for revision in history] == [2, 1]
    assert [revision.note for revision in history] == [
        "Changed genotype",
        "Original labels",
    ]
    assert version_one.parent_revision_id is None
    assert version_two.parent_revision_id == version_one.revision_id
    assert historical.state.label_rows[0].cells[0].text == "WT"
    assert restored.state.label_rows[0].cells[0].text == "WT"
    assert len(restored_history) == 3
    assert restored_history[0].note == "Restored from v1"
    assert restored_history[0].parent_revision_id == version_two.revision_id
    assert restored.current_revision_id == restored_history[0].revision_id
    assert project_store.load_revision(
        project_id, version_two.revision_id
    ).state.label_rows[0].cells[0].text == "Mutant"
