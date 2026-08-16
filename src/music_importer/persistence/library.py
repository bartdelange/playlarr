"""Library status, export, and playlist-analysis persistence."""

import json
import uuid
from pathlib import Path

from .timestamps import now


class LibraryRepository:
    def save_library_status(self, import_id: str, statuses) -> None:
        entries = self.entries(import_id)
        by_position = {entry.position: entry for entry in entries}
        with self.connect() as db:
            for status in statuses:
                entry = by_position[status.position]
                db.execute(
                    """INSERT INTO library_status
                    (entry_id, classification, file_path, refreshed_at) VALUES (?, ?, ?, ?)
                    ON CONFLICT(entry_id) DO UPDATE SET classification = excluded.classification,
                    file_path = excluded.file_path, refreshed_at = excluded.refreshed_at""",
                    (entry.id, status.classification, status.path, now()),
                )
            # A read-only status refresh must not advance an import that has not
            # been resolved/planned yet (and therefore hide its next action).
            db.execute(
                """UPDATE imports SET
                workflow_state = CASE
                    WHEN workflow_state IN ('waiting_for_downloads', 'library_status',
                                            'playlist_generated') THEN 'library_status'
                    ELSE workflow_state
                END,
                updated_at = ? WHERE id = ?""",
                (now(), import_id),
            )

    def library_status(self, import_id: str) -> dict[int, tuple[str, str | None]]:
        with self.connect() as db:
            rows = db.execute(
                """SELECT e.position, s.classification, s.file_path
                FROM playlist_entries e JOIN library_status s ON s.entry_id = e.id
                WHERE e.import_id = ? ORDER BY e.position""",
                (import_id,),
            ).fetchall()
        return {row["position"]: (row["classification"], row["file_path"]) for row in rows}

    def record_playlist_export(
        self, import_id: str, output_path: Path, written: int, missing: int
    ) -> str:
        identifier = str(uuid.uuid4())
        with self.connect() as db:
            db.execute(
                """INSERT INTO playlist_exports
                (id, import_id, output_path, written_tracks, missing_tracks,
                 created_at) VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    identifier,
                    import_id,
                    str(output_path),
                    written,
                    missing,
                    now(),
                ),
            )
            db.execute(
                "UPDATE imports SET workflow_state = 'playlist_generated', updated_at = ? WHERE id = ?",
                (now(), import_id),
            )
        return identifier

    def latest_playlist_export(self, import_id: str) -> dict | None:
        with self.connect() as db:
            row = db.execute(
                """SELECT * FROM playlist_exports WHERE import_id = ?
                ORDER BY created_at DESC LIMIT 1""",
                (import_id,),
            ).fetchone()
        return dict(row) if row else None

    def save_playlist_analysis(
        self, source: str, playlist_id: str, playlist_name: str, status: str, result: dict
    ) -> None:
        with self.connect() as db:
            db.execute(
                """INSERT INTO playlist_analyses
                (source, playlist_id, playlist_name, status, result_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(source, playlist_id) DO UPDATE SET playlist_name = excluded.playlist_name,
                status = excluded.status, result_json = excluded.result_json,
                updated_at = excluded.updated_at""",
                (source, playlist_id, playlist_name, status, json.dumps(result), now()),
            )

    def playlist_analyses(self, source: str) -> dict[str, dict]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM playlist_analyses WHERE source = ?", (source,)
            ).fetchall()
        return {
            row["playlist_id"]: {
                "status": row["status"],
                "updated_at": row["updated_at"],
                **json.loads(row["result_json"]),
            }
            for row in rows
        }
