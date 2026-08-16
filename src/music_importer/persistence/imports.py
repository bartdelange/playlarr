"""Persistence operations for imports and acquired playlist entries."""

import json
import uuid

from ..domain.models import AcquiredTrack, PlaylistInfo, SourceTrack
from .records import StoredImport
from .timestamps import now


class ImportsRepository:
    def settings(self) -> dict[str, object]:
        with self.connect() as db:
            rows = db.execute("SELECT key, value_json FROM settings").fetchall()
        return {row["key"]: json.loads(row["value_json"]) for row in rows}

    def create_import(
        self, playlist: PlaylistInfo, *, metadata: dict | None = None, import_id: str | None = None
    ) -> StoredImport:
        identifier = import_id or str(uuid.uuid4())
        timestamp = now()
        with self.connect() as db:
            db.execute(
                """INSERT INTO imports
                (id, source, source_playlist_id, playlist_name, playlist_path,
                 playlist_metadata_json, workflow_state, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'acquiring', ?, ?)""",
                (
                    identifier,
                    playlist.source,
                    playlist.id,
                    playlist.name,
                    playlist.path,
                    json.dumps(metadata or {}),
                    timestamp,
                    timestamp,
                ),
            )
        return self.get_import(identifier)

    def get_import(self, import_id: str) -> StoredImport:
        with self.connect() as db:
            row = db.execute("SELECT * FROM imports WHERE id = ?", (import_id,)).fetchone()
        if row is None:
            raise KeyError(f"unknown import: {import_id}")
        return StoredImport(
            row["id"],
            row["source"],
            row["source_playlist_id"],
            row["playlist_name"],
            row["playlist_path"],
            row["workflow_state"],
            row["created_at"],
            row["updated_at"],
            row["last_error"],
        )

    def list_imports(self) -> list[StoredImport]:
        with self.connect() as db:
            ids = [row[0] for row in db.execute("SELECT id FROM imports ORDER BY updated_at DESC")]
        imports = [self.get_import(identifier) for identifier in ids]
        canonical: dict[tuple[str, str], StoredImport] = {}
        rank = {
            "playlist_generated": 100,
            "library_status": 90,
            "waiting_for_downloads": 80,
            "execution_failed": 75,
            "plan_ready": 70,
            "ready_to_plan": 60,
            "review_required": 50,
            "resolution_interrupted": 45,
            "resolving": 40,
            "ready_to_resolve": 30,
            "acquiring": 20,
        }
        for imported in imports:
            key = (imported.source, imported.source_playlist_id)
            current = canonical.get(key)
            if current is None or rank.get(imported.workflow_state, 0) > rank.get(
                current.workflow_state, 0
            ):
                canonical[key] = imported
        return sorted(canonical.values(), key=lambda item: item.updated_at, reverse=True)

    def find_import(self, source: str, source_playlist_id: str) -> StoredImport | None:
        """Return the canonical import for a source playlist, if it was imported before."""
        return next(
            (
                item
                for item in self.list_imports()
                if item.source == source and item.source_playlist_id == source_playlist_id
            ),
            None,
        )

    def set_workflow_state(self, import_id: str, state: str, error: str | None = None) -> None:
        with self.connect() as db:
            db.execute(
                "UPDATE imports SET workflow_state = ?, last_error = ?, updated_at = ? WHERE id = ?",
                (state, error, now(), import_id),
            )

    def update_import_playlist(
        self, import_id: str, playlist: PlaylistInfo, *, metadata: dict | None = None
    ) -> None:
        with self.connect() as db:
            db.execute(
                """UPDATE imports SET playlist_name = ?, playlist_path = ?,
                playlist_metadata_json = ?, updated_at = ? WHERE id = ?""",
                (
                    playlist.name,
                    playlist.path,
                    json.dumps(metadata or {}),
                    now(),
                    import_id,
                ),
            )

    def replace_tracks(self, import_id: str, tracks: list[SourceTrack]) -> None:
        self.replace_acquired_tracks(
            import_id, [AcquiredTrack(position, track) for position, track in enumerate(tracks)]
        )

    def replace_acquired_tracks(self, import_id: str, entries: list[AcquiredTrack]) -> None:
        with self.connect() as db:
            db.execute("DELETE FROM playlist_entries WHERE import_id = ?", (import_id,))
            for acquired in entries:
                position, track = acquired.position, acquired.track
                cursor = db.execute(
                    """INSERT INTO playlist_entries
                    (import_id, position, source_track_id, title, artists_json, album, isrc,
                     duration_ms, acquisition_status, skip_reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        import_id,
                        position,
                        track.source_track_id,
                        track.title,
                        json.dumps(track.artists),
                        track.album,
                        track.isrc,
                        track.duration_ms,
                        "skipped" if acquired.skip_reason else "acquired",
                        acquired.skip_reason,
                    ),
                )
                db.execute(
                    """INSERT INTO resolutions
                    (entry_id, state, method, result_json, evidence_json, updated_at)
                    VALUES (?, ?, ?, '{}', ?, ?)""",
                    (
                        cursor.lastrowid,
                        "skipped" if acquired.skip_reason else "pending",
                        "source_skip" if acquired.skip_reason else None,
                        json.dumps({"skip_reason": acquired.skip_reason})
                        if acquired.skip_reason
                        else "{}",
                        now(),
                    ),
                )
            db.execute(
                "UPDATE imports SET workflow_state = 'ready_to_resolve', updated_at = ? WHERE id = ?",
                (now(), import_id),
            )
