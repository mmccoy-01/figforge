"""Local project persistence and portable FigForge project bundles."""

from __future__ import annotations

import json
import sqlite3
import tempfile
import threading
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Mapping

from .assets import AssetRecord, AssetStore, AssetValidationError
from .models import CanvasState


BUNDLE_FORMAT_VERSION = 1
MAX_BUNDLE_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024


class ProjectBundleError(ValueError):
    """Raised when a portable project bundle is invalid or unsafe."""


@dataclass(frozen=True, slots=True)
class ProjectSummary:
    project_id: str
    name: str
    created_at: str
    updated_at: str
    thumbnail_url: str | None
    revision_count: int


@dataclass(frozen=True, slots=True)
class ProjectRecord:
    project_id: str
    name: str
    created_at: str
    updated_at: str
    current_revision_id: str | None
    state: CanvasState
    assets: tuple[AssetRecord, ...]


@dataclass(frozen=True, slots=True)
class RevisionSummary:
    revision_id: str
    project_id: str
    parent_revision_id: str | None
    version_number: int
    created_at: str
    note: str


@dataclass(frozen=True, slots=True)
class RevisionRecord:
    revision_id: str
    project_id: str
    parent_revision_id: str | None
    version_number: int
    created_at: str
    note: str
    state: CanvasState


class ProjectStore:
    """SQLite-backed mutable drafts for the local single-user application."""

    def __init__(self, database_path: Path) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self._lock, self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    current_revision_id TEXT,
                    thumbnail_asset_id TEXT,
                    state_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS assets (
                    project_id TEXT NOT NULL,
                    asset_id TEXT NOT NULL,
                    original_filename TEXT NOT NULL,
                    storage_filename TEXT NOT NULL,
                    preview_filename TEXT,
                    mime_type TEXT NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (project_id, asset_id),
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS revisions (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    parent_revision_id TEXT,
                    created_at TEXT NOT NULL,
                    note TEXT NOT NULL DEFAULT '',
                    state_json TEXT NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS projects_updated_at_idx
                    ON projects(updated_at DESC);
                CREATE INDEX IF NOT EXISTS revisions_project_id_idx
                    ON revisions(project_id, created_at DESC);
                """
            )

    def save_draft(
        self,
        project_id: str,
        name: str,
        state: CanvasState,
        assets: Iterable[AssetRecord],
    ) -> ProjectRecord:
        """Create or update one mutable project draft."""

        now = datetime.now(timezone.utc).isoformat()
        safe_name = name.strip() or "Untitled figure"
        asset_records = tuple(assets)
        thumbnail_asset_id = state.images[0].asset_id if state.images else None
        state_json = json.dumps(state.to_dict(), separators=(",", ":"), ensure_ascii=False)

        with self._lock, self._connect() as connection:
            existing = connection.execute(
                "SELECT created_at, current_revision_id FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            created_at = existing["created_at"] if existing else now
            connection.execute(
                """
                INSERT INTO projects (
                    id, name, created_at, updated_at, current_revision_id,
                    thumbnail_asset_id, state_json
                ) VALUES (?, ?, ?, ?, NULL, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    updated_at = excluded.updated_at,
                    thumbnail_asset_id = excluded.thumbnail_asset_id,
                    state_json = excluded.state_json
                """,
                (project_id, safe_name, created_at, now, thumbnail_asset_id, state_json),
            )
            connection.execute("DELETE FROM assets WHERE project_id = ?", (project_id,))
            connection.executemany(
                """
                INSERT INTO assets (
                    project_id, asset_id, original_filename, storage_filename,
                    preview_filename, mime_type, width, height, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        project_id,
                        asset.asset_id,
                        asset.filename,
                        asset.storage_filename,
                        asset.preview_filename,
                        asset.mime_type,
                        asset.width,
                        asset.height,
                        asset.created_at,
                    )
                    for asset in asset_records
                ],
            )
        return ProjectRecord(
            project_id=project_id,
            name=safe_name,
            created_at=created_at,
            updated_at=now,
            current_revision_id=(
                str(existing["current_revision_id"])
                if existing and existing["current_revision_id"] is not None
                else None
            ),
            state=state,
            assets=asset_records,
        )

    def load_project(self, project_id: str) -> ProjectRecord:
        with self._lock, self._connect() as connection:
            project = connection.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if project is None:
                raise KeyError(f"Unknown project: {project_id}")
            assets = connection.execute(
                "SELECT * FROM assets WHERE project_id = ? ORDER BY rowid", (project_id,)
            ).fetchall()
        return ProjectRecord(
            project_id=project["id"],
            name=project["name"],
            created_at=project["created_at"],
            updated_at=project["updated_at"],
            current_revision_id=(
                str(project["current_revision_id"])
                if project["current_revision_id"] is not None
                else None
            ),
            state=CanvasState.from_mapping(json.loads(project["state_json"])),
            assets=tuple(_asset_from_row(row) for row in assets),
        )

    def list_projects(self) -> tuple[ProjectSummary, ...]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT p.id, p.name, p.created_at, p.updated_at,
                       a.storage_filename, a.preview_filename,
                       (SELECT COUNT(*) FROM revisions AS r WHERE r.project_id = p.id)
                           AS revision_count
                FROM projects AS p
                LEFT JOIN assets AS a
                  ON a.project_id = p.id AND a.asset_id = p.thumbnail_asset_id
                ORDER BY p.updated_at DESC
                """
            ).fetchall()
        return tuple(
            ProjectSummary(
                project_id=row["id"],
                name=row["name"],
                created_at=row["created_at"],
                updated_at=row["updated_at"],
                thumbnail_url=(
                    f"/assets/{row['preview_filename'] or row['storage_filename']}"
                    if row["storage_filename"]
                    else None
                ),
                revision_count=int(row["revision_count"]),
            )
            for row in rows
        )

    def create_revision(self, project_id: str, note: str = "") -> RevisionRecord:
        """Checkpoint the current mutable draft as a new immutable revision."""

        revision_id = uuid.uuid4().hex
        created_at = datetime.now(timezone.utc).isoformat()
        safe_note = note.strip()
        with self._lock, self._connect() as connection:
            project = connection.execute(
                "SELECT current_revision_id, state_json FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            if project is None:
                raise KeyError(f"Unknown project: {project_id}")
            connection.execute(
                """
                INSERT INTO revisions (
                    id, project_id, parent_revision_id, created_at, note, state_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    revision_id,
                    project_id,
                    project["current_revision_id"],
                    created_at,
                    safe_note,
                    project["state_json"],
                ),
            )
            connection.execute(
                """
                UPDATE projects
                SET current_revision_id = ?, updated_at = ?
                WHERE id = ?
                """,
                (revision_id, created_at, project_id),
            )
            version_number = len(self._revision_rows(connection, project_id))
        return RevisionRecord(
            revision_id=revision_id,
            project_id=project_id,
            parent_revision_id=(
                str(project["current_revision_id"])
                if project["current_revision_id"] is not None
                else None
            ),
            version_number=version_number,
            created_at=created_at,
            note=safe_note,
            state=CanvasState.from_mapping(json.loads(project["state_json"])),
        )

    def list_revisions(self, project_id: str) -> tuple[RevisionSummary, ...]:
        """Return newest-first immutable checkpoints for a project."""

        with self._lock, self._connect() as connection:
            project_exists = connection.execute(
                "SELECT 1 FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if project_exists is None:
                raise KeyError(f"Unknown project: {project_id}")
            rows = self._revision_rows(connection, project_id)
        return tuple(
            RevisionSummary(
                revision_id=str(row["id"]),
                project_id=str(row["project_id"]),
                parent_revision_id=(
                    str(row["parent_revision_id"])
                    if row["parent_revision_id"] is not None
                    else None
                ),
                version_number=index,
                created_at=str(row["created_at"]),
                note=str(row["note"]),
            )
            for index, row in reversed(tuple(enumerate(rows, start=1)))
        )

    def load_revision(self, project_id: str, revision_id: str) -> RevisionRecord:
        """Load one historical revision without changing the current draft."""

        with self._lock, self._connect() as connection:
            rows = self._revision_rows(connection, project_id)
        for version_number, row in enumerate(rows, start=1):
            if row["id"] == revision_id:
                return _revision_from_row(row, version_number)
        raise KeyError(f"Unknown revision: {revision_id}")

    def restore_revision(self, project_id: str, revision_id: str) -> ProjectRecord:
        """Restore historical state as a new head revision, preserving newer history."""

        restored_revision_id = uuid.uuid4().hex
        restored_at = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as connection:
            project = connection.execute(
                "SELECT current_revision_id FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if project is None:
                raise KeyError(f"Unknown project: {project_id}")
            rows = self._revision_rows(connection, project_id)
            source = next(
                (
                    (index, row)
                    for index, row in enumerate(rows, start=1)
                    if row["id"] == revision_id
                ),
                None,
            )
            if source is None:
                raise KeyError(f"Unknown revision: {revision_id}")
            source_version, source_row = source
            source_state = CanvasState.from_mapping(json.loads(source_row["state_json"]))
            thumbnail_asset_id = (
                source_state.images[0].asset_id if source_state.images else None
            )
            connection.execute(
                """
                INSERT INTO revisions (
                    id, project_id, parent_revision_id, created_at, note, state_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    restored_revision_id,
                    project_id,
                    project["current_revision_id"],
                    restored_at,
                    f"Restored from v{source_version}",
                    source_row["state_json"],
                ),
            )
            connection.execute(
                """
                UPDATE projects
                SET current_revision_id = ?, updated_at = ?, thumbnail_asset_id = ?,
                    state_json = ?
                WHERE id = ?
                """,
                (
                    restored_revision_id,
                    restored_at,
                    thumbnail_asset_id,
                    source_row["state_json"],
                    project_id,
                ),
            )
        return self.load_project(project_id)

    @staticmethod
    def _revision_rows(
        connection: sqlite3.Connection, project_id: str
    ) -> tuple[sqlite3.Row, ...]:
        return tuple(
            connection.execute(
                """
                SELECT id, project_id, parent_revision_id, created_at, note, state_json
                FROM revisions
                WHERE project_id = ?
                ORDER BY created_at ASC, id ASC
                """,
                (project_id,),
            ).fetchall()
        )


def create_project_bundle(
    name: str,
    state: CanvasState,
    assets: Iterable[AssetRecord],
    asset_store: AssetStore,
    destination: Path,
) -> Path:
    """Create a portable ZIP bundle with JSON state and immutable sources."""

    asset_records = tuple(assets)
    manifest_assets: list[dict[str, Any]] = []
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for asset in asset_records:
            source = asset_store.root / asset.storage_filename
            if not source.is_file():
                raise FileNotFoundError(f"Missing source asset: {asset.filename}")
            archive_name = f"assets/{asset.asset_id}{Path(asset.storage_filename).suffix.lower()}"
            archive.write(source, archive_name)
            manifest_assets.append(
                {
                    "asset_id": asset.asset_id,
                    "filename": asset.filename,
                    "archive_path": archive_name,
                }
            )
        manifest = {
            "format": "figforge-project",
            "format_version": BUNDLE_FORMAT_VERSION,
            "name": name.strip() or "Untitled figure",
            "state": state.to_dict(),
            "assets": manifest_assets,
        }
        archive.writestr(
            "manifest.json",
            json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8"),
        )
    return destination


def import_project_bundle(
    bundle_path: Path,
    asset_store: AssetStore,
) -> tuple[str, CanvasState, tuple[AssetRecord, ...]]:
    """Validate and import a portable bundle, remapping asset identifiers."""

    imported: list[AssetRecord] = []
    try:
        with zipfile.ZipFile(bundle_path) as archive:
            members = archive.infolist()
            if sum(member.file_size for member in members) > MAX_BUNDLE_UNCOMPRESSED_BYTES:
                raise ProjectBundleError("The project bundle is too large")
            try:
                manifest = json.loads(archive.read("manifest.json"))
            except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ProjectBundleError("The project bundle has no valid manifest") from exc
            if manifest.get("format") != "figforge-project":
                raise ProjectBundleError("The selected file is not a FigForge project")
            if int(manifest.get("format_version", 0)) != BUNDLE_FORMAT_VERSION:
                raise ProjectBundleError("Unsupported FigForge project bundle version")
            original_state = CanvasState.from_mapping(manifest.get("state", {}))
            asset_entries = manifest.get("assets", [])
            if not isinstance(asset_entries, list):
                raise ProjectBundleError("Project bundle assets are invalid")

            remapped: dict[str, AssetRecord] = {}
            with tempfile.TemporaryDirectory(prefix="figforge-import-") as temporary:
                temporary_root = Path(temporary)
                for index, entry in enumerate(asset_entries):
                    old_asset_id = str(entry.get("asset_id", ""))
                    archive_path = str(entry.get("archive_path", ""))
                    pure_path = PurePosixPath(archive_path)
                    if (
                        not old_asset_id
                        or pure_path.is_absolute()
                        or ".." in pure_path.parts
                        or not archive_path.startswith("assets/")
                    ):
                        raise ProjectBundleError("Project bundle contains an unsafe asset path")
                    try:
                        source_bytes = archive.read(archive_path)
                    except KeyError as exc:
                        raise ProjectBundleError("Project bundle is missing a source asset") from exc
                    temporary_source = temporary_root / f"asset-{index}{pure_path.suffix}"
                    temporary_source.write_bytes(source_bytes)
                    record = asset_store.import_upload(
                        temporary_source,
                        original_filename=str(entry.get("filename", temporary_source.name)),
                    )
                    imported.append(record)
                    remapped[old_asset_id] = record

            state_mapping = original_state.to_dict()
            for image in state_mapping["images"]:
                record = remapped.get(image["asset_id"])
                if record is None:
                    raise ProjectBundleError("Project state references a missing source asset")
                image["asset_id"] = record.asset_id
                image["filename"] = record.filename
                image["source_url"] = record.source_url
                image["display_url"] = record.url
            return (
                str(manifest.get("name", "Untitled figure")).strip() or "Untitled figure",
                CanvasState.from_mapping(state_mapping),
                tuple(imported),
            )
    except (zipfile.BadZipFile, OSError, AssetValidationError, ValueError) as exc:
        for record in imported:
            asset_store.delete(record)
        if isinstance(exc, ProjectBundleError):
            raise
        raise ProjectBundleError("FigForge could not open this project bundle") from exc


def remap_canvas_assets(
    state: CanvasState,
    assets_by_old_id: Mapping[str, AssetRecord],
) -> CanvasState:
    """Replace expired browser asset references with newly imported records."""

    state_mapping = state.to_dict()
    for image in state_mapping["images"]:
        record = assets_by_old_id.get(str(image["asset_id"]))
        if record is None:
            raise ProjectBundleError("Browser recovery is missing a source image")
        image["asset_id"] = record.asset_id
        image["filename"] = record.filename
        image["source_url"] = record.source_url
        image["display_url"] = record.url
    return CanvasState.from_mapping(state_mapping)


def new_project_id() -> str:
    return uuid.uuid4().hex


def _asset_from_row(row: Mapping[str, Any]) -> AssetRecord:
    return AssetRecord(
        asset_id=str(row["asset_id"]),
        filename=str(row["original_filename"]),
        storage_filename=str(row["storage_filename"]),
        preview_filename=(
            str(row["preview_filename"]) if row["preview_filename"] is not None else None
        ),
        mime_type=str(row["mime_type"]),
        width=int(row["width"]),
        height=int(row["height"]),
        created_at=str(row["created_at"]),
    )


def _revision_from_row(row: Mapping[str, Any], version_number: int) -> RevisionRecord:
    return RevisionRecord(
        revision_id=str(row["id"]),
        project_id=str(row["project_id"]),
        parent_revision_id=(
            str(row["parent_revision_id"])
            if row["parent_revision_id"] is not None
            else None
        ),
        version_number=version_number,
        created_at=str(row["created_at"]),
        note=str(row["note"]),
        state=CanvasState.from_mapping(json.loads(str(row["state_json"]))),
    )


__all__ = [
    "ProjectBundleError",
    "ProjectRecord",
    "ProjectStore",
    "ProjectSummary",
    "RevisionRecord",
    "RevisionSummary",
    "create_project_bundle",
    "import_project_bundle",
    "new_project_id",
    "remap_canvas_assets",
]
