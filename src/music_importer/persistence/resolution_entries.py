import json

from ..domain.models import MusicBrainzResult, SourceTrack
from .records import ManualMatchSuggestion, StoredEntry


class ResolutionEntriesRepository:
    def entries(self, import_id: str) -> list[StoredEntry]:
        with self.connect() as db:
            rows = db.execute(
                """SELECT e.*, r.state, r.method, r.result_json, r.evidence_json,
                r.is_manual, r.validation_status, r.selected_release_group_id
                FROM playlist_entries e JOIN resolutions r ON r.entry_id = e.id
                WHERE e.import_id = ? ORDER BY e.position""",
                (import_id,),
            ).fetchall()
        result = []
        for row in rows:
            raw = json.loads(row["result_json"] or "{}")
            for field in (
                "artist_names",
                "recording_ids",
                "release_ids",
                "release_group_ids",
                "artist_ids",
            ):
                raw[field] = tuple(raw.get(field) or ())
            mb_result = MusicBrainzResult(**raw) if raw else MusicBrainzResult()
            track = SourceTrack(
                row["source"] if "source" in row.keys() else self.get_import(import_id).source,
                row["source_track_id"],
                row["title"],
                tuple(json.loads(row["artists_json"])),
                row["album"],
                row["isrc"],
                row["duration_ms"],
            )
            result.append(
                StoredEntry(
                    row["id"],
                    import_id,
                    row["position"],
                    track,
                    row["state"],
                    mb_result,
                    row["method"],
                    json.loads(row["evidence_json"] or "{}"),
                    bool(row["is_manual"]),
                    row["validation_status"],
                    row["selected_release_group_id"],
                )
            )
        return result

    def entry(self, entry_id: int) -> StoredEntry:
        with self.connect() as db:
            row = db.execute(
                "SELECT import_id FROM playlist_entries WHERE id = ?", (entry_id,)
            ).fetchone()
        if row is None:
            raise KeyError(f"unknown playlist entry: {entry_id}")
        return next(entry for entry in self.entries(row["import_id"]) if entry.id == entry_id)

    def manual_match_suggestions(self, entry_id: int) -> list[ManualMatchSuggestion]:
        """Find human-approved mappings for the exact same source track or ISRC."""
        target = self.entry(entry_id)
        target_import = self.get_import(target.import_id)
        suggestions: list[ManualMatchSuggestion] = []
        with self.connect() as db:
            rows = db.execute(
                """SELECT e.id, i.playlist_name
                FROM playlist_entries e
                JOIN imports i ON i.id = e.import_id
                JOIN resolutions r ON r.entry_id = e.id
                WHERE e.id != ? AND r.state = 'manually_resolved' AND r.is_manual = 1
                  AND ((? != '' AND e.isrc = ?)
                    OR (i.source = ? AND e.source_track_id = ?))
                ORDER BY r.confirmed_at DESC""",
                (
                    entry_id,
                    target.track.isrc or "",
                    target.track.isrc or "",
                    target_import.source,
                    target.track.source_track_id,
                ),
            ).fetchall()
        seen_results: set[tuple] = set()
        for row in rows:
            candidate = self.entry(row["id"])
            identity = (candidate.result.recording_ids, candidate.result.release_group_ids)
            if identity in seen_results:
                continue
            seen_results.add(identity)
            suggestions.append(ManualMatchSuggestion(candidate, row["playlist_name"]))
        return suggestions
