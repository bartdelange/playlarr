"""Durable local-library additions composed into playlist exports."""

import json

from ..domain.models import LocalPlaylistAddition
from .timestamps import now


class LocalPlaylistAdditionsRepository:
    def local_playlist_additions(self, import_id: str) -> list[LocalPlaylistAddition]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM local_playlist_additions WHERE import_id = ? ORDER BY ordinal, id",
                (import_id,),
            ).fetchall()
        return [
            LocalPlaylistAddition(
                row["id"],
                row["import_id"],
                row["provider"],
                row["provider_track_id"],
                row["ordinal"],
                row["title"],
                tuple(json.loads(row["artists_json"])),
                row["album"],
                row["path_snapshot"],
            )
            for row in rows
        ]

    def add_local_playlist_track(
        self,
        import_id: str,
        provider: str,
        provider_track_id: str,
        title: str,
        artists: tuple[str, ...],
        album: str,
        path_snapshot: str = "",
    ) -> int:
        self.get_import(import_id)
        with self.connect() as db:
            ordinal = db.execute(
                "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM local_playlist_additions WHERE import_id = ?",
                (import_id,),
            ).fetchone()[0]
            cursor = db.execute(
                """INSERT INTO local_playlist_additions
                (import_id, provider, provider_track_id, ordinal, title, artists_json, album,
                 path_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    import_id,
                    provider,
                    provider_track_id,
                    ordinal,
                    title,
                    json.dumps(artists),
                    album,
                    path_snapshot,
                    now(),
                ),
            )
        return cursor.lastrowid

    def remove_local_playlist_track(self, import_id: str, addition_id: int) -> None:
        with self.connect() as db:
            cursor = db.execute(
                "DELETE FROM local_playlist_additions WHERE id = ? AND import_id = ?",
                (addition_id, import_id),
            )
            if not cursor.rowcount:
                raise KeyError(f"local playlist addition {addition_id} does not exist")
