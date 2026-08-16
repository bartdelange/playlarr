"""Transactional playlist update and revision persistence."""

import json
import uuid

from ..domain.models import AcquiredTrack, PlaylistInfo
from .records import PlaylistRevision, PlaylistUpdate, StoredEntry
from .timestamps import now


class PlaylistRevisionsRepository:
    @staticmethod
    def _match_update(old_entries: list[StoredEntry], new_entries: list[AcquiredTrack]):
        """Match duplicate playlist occurrences without collapsing them."""
        unmatched = {entry.id: entry for entry in old_entries}
        matches: dict[int, StoredEntry] = {}
        for key in ("source_track_id", "isrc"):
            buckets: dict[str, list[StoredEntry]] = {}
            for old in old_entries:
                if old.id not in unmatched:
                    continue
                value = getattr(old.track, key)
                if value:
                    buckets.setdefault(value, []).append(old)
            for index, acquired in enumerate(new_entries):
                if index in matches:
                    continue
                value = getattr(acquired.track, key)
                candidates = buckets.get(value or "", [])
                if candidates:
                    old = candidates.pop(0)
                    matches[index] = old
                    unmatched.pop(old.id, None)
        return matches, list(unmatched.values())

    def preview_playlist_update(
        self, import_id: str, entries: list[AcquiredTrack]
    ) -> PlaylistUpdate:
        old_entries = self.entries(import_id)
        matches, removed = self._match_update(old_entries, entries)
        moved = sum(old.position != entries[index].position for index, old in matches.items())
        return PlaylistUpdate(
            len(entries) - len(matches), len(removed), moved, len(matches) - moved
        )

    def apply_playlist_update(
        self, import_id: str, playlist: PlaylistInfo, entries: list[AcquiredTrack]
    ) -> PlaylistUpdate:
        old_entries = self.entries(import_id)
        matches, removed = self._match_update(old_entries, entries)
        summary = PlaylistUpdate(
            len(entries) - len(matches),
            len(removed),
            sum(old.position != entries[index].position for index, old in matches.items()),
            sum(old.position == entries[index].position for index, old in matches.items()),
        )
        timestamp = now()

        def snapshot(items):
            return [
                {
                    "position": item.position,
                    "source_track_id": item.track.source_track_id,
                    "title": item.track.title,
                    "artists": list(item.track.artists),
                    "album": item.track.album,
                    "isrc": item.track.isrc,
                }
                for item in items
            ]

        with self.connect() as db:
            db.execute(
                "UPDATE playlist_entries SET position = -position - 1 WHERE import_id = ?",
                (import_id,),
            )
            for index, acquired in enumerate(entries):
                track = acquired.track
                old = matches.get(index)
                if old:
                    db.execute(
                        """UPDATE playlist_entries SET position = ?, source_track_id = ?,
                        title = ?, artists_json = ?, album = ?, isrc = ?, duration_ms = ?,
                        acquisition_status = ?, skip_reason = ? WHERE id = ?""",
                        (
                            acquired.position,
                            track.source_track_id,
                            track.title,
                            json.dumps(track.artists),
                            track.album,
                            track.isrc,
                            track.duration_ms,
                            "skipped" if acquired.skip_reason else "acquired",
                            acquired.skip_reason,
                            old.id,
                        ),
                    )
                    if acquired.skip_reason and old.resolution_method != "source_skip":
                        db.execute(
                            """UPDATE resolutions SET state = 'skipped',
                            method = 'source_skip', result_json = '{}', evidence_json = ?,
                            is_manual = 0, validation_status = NULL, confirmed_at = NULL,
                            updated_at = ? WHERE entry_id = ?""",
                            (json.dumps({"skip_reason": acquired.skip_reason}), timestamp, old.id),
                        )
                    elif not acquired.skip_reason and old.resolution_method == "source_skip":
                        db.execute(
                            """UPDATE resolutions SET state = 'pending', method = NULL,
                            result_json = '{}', evidence_json = '{}', updated_at = ?
                            WHERE entry_id = ?""",
                            (timestamp, old.id),
                        )
                else:
                    cursor = db.execute(
                        """INSERT INTO playlist_entries
                        (import_id, position, source_track_id, title, artists_json, album, isrc,
                         duration_ms, acquisition_status, skip_reason)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            import_id,
                            acquired.position,
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
                            timestamp,
                        ),
                    )
            for old in removed:
                db.execute("DELETE FROM playlist_entries WHERE id = ?", (old.id,))
            db.execute(
                "UPDATE lidarr_plans SET status = 'superseded' "
                "WHERE import_id = ? AND status IN ('draft', 'approved')",
                (import_id,),
            )
            db.execute(
                "DELETE FROM library_status WHERE entry_id IN "
                "(SELECT id FROM playlist_entries WHERE import_id = ?)",
                (import_id,),
            )
            state = "ready_to_resolve" if summary.added else "ready_to_plan"
            db.execute(
                """UPDATE imports SET playlist_name = ?, playlist_path = ?,
                workflow_state = ?, updated_at = ? WHERE id = ?""",
                (playlist.name, playlist.path, state, timestamp, import_id),
            )
            db.execute(
                """INSERT INTO playlist_revisions
                (id, import_id, created_at, before_json, after_json,
                 added, removed, moved, unchanged) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(uuid.uuid4()),
                    import_id,
                    timestamp,
                    json.dumps(snapshot(old_entries)),
                    json.dumps(snapshot(entries)),
                    summary.added,
                    summary.removed,
                    summary.moved,
                    summary.unchanged,
                ),
            )
        return summary

    def playlist_revisions(self, import_id: str) -> list[PlaylistRevision]:
        with self.connect() as db:
            rows = db.execute(
                """SELECT id, created_at, added, removed, moved, unchanged
                FROM playlist_revisions WHERE import_id = ? ORDER BY created_at DESC""",
                (import_id,),
            ).fetchall()
        return [
            PlaylistRevision(
                row["id"],
                row["created_at"],
                row["added"],
                row["removed"],
                row["moved"],
                row["unchanged"],
            )
            for row in rows
        ]

    def playlist_revision(self, import_id: str, revision_id: str) -> dict:
        with self.connect() as db:
            row = db.execute(
                """SELECT * FROM playlist_revisions
                WHERE id = ? AND import_id = ?""",
                (revision_id, import_id),
            ).fetchone()
        if row is None:
            raise KeyError(f"unknown playlist revision: {revision_id}")
        return {
            "id": row["id"],
            "created_at": row["created_at"],
            "before": json.loads(row["before_json"]),
            "after": json.loads(row["after_json"]),
            "added": row["added"],
            "removed": row["removed"],
            "moved": row["moved"],
            "unchanged": row["unchanged"],
        }
