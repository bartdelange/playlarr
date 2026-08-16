"""Preview and apply explicit cross-import mapping reuse."""

import json

from .records import MappingOverrideCandidate
from .timestamps import now


class MappingOverridesRepository:
    @staticmethod
    def _mapping_identity(entry) -> tuple:
        return (
            entry.result.recording_ids,
            entry.result.release_group_ids,
            entry.result.primary_artist_id,
        )

    def mapping_override_candidates(
        self, target_import_id: str, source_import_id: str
    ) -> list[MappingOverrideCandidate]:
        if target_import_id == source_import_id:
            raise ValueError("source and target imports must be different")
        target_entries = self.entries(target_import_id)
        source_entries = self.entries(source_import_id)
        by_isrc: dict[str, list] = {}
        for entry in source_entries:
            if entry.track.isrc and entry.result.resolved_via:
                by_isrc.setdefault(entry.track.isrc, []).append(entry)

        candidates = []
        for target in target_entries:
            matches = by_isrc.get(target.track.isrc or "", [])
            if not matches:
                continue
            identities = {self._mapping_identity(entry) for entry in matches}
            source = matches[0]
            if len(identities) > 1:
                status = "conflict"
            elif self._mapping_identity(target) == self._mapping_identity(source):
                status = "already_same"
            elif target.result.resolved_via:
                status = "will_override"
            else:
                status = "will_map"
            candidates.append(MappingOverrideCandidate(target, source, status))
        return candidates

    def apply_mapping_overrides(
        self, target_import_id: str, source_import_id: str, target_entry_ids: set[int]
    ) -> int:
        candidates = self.mapping_override_candidates(target_import_id, source_import_id)
        selected = [
            item
            for item in candidates
            if item.target.id in target_entry_ids
            and item.source is not None
            and item.status in {"will_override", "will_map"}
        ]
        timestamp = now()
        with self.connect() as db:
            for item in selected:
                source = item.source
                evidence = dict(source.evidence)
                evidence.update(
                    {
                        "reused_from_entry_id": source.id,
                        "reused_from_import_id": source_import_id,
                        "matched_by": "isrc",
                    }
                )
                db.execute(
                    """UPDATE resolutions SET state = 'manually_resolved',
                    method = 'reused_manual', result_json = ?, evidence_json = ?, is_manual = 1,
                    validation_status = ?, selected_release_group_id = ?, confirmed_at = ?,
                    updated_at = ? WHERE entry_id = ?""",
                    (
                        self._result_json(source.result),
                        json.dumps(evidence),
                        source.validation_status or "valid",
                        source.selected_release_group_id,
                        timestamp,
                        timestamp,
                        item.target.id,
                    ),
                )
                db.execute("DELETE FROM library_status WHERE entry_id = ?", (item.target.id,))
            if selected:
                db.execute(
                    """UPDATE lidarr_plans SET status = 'superseded'
                    WHERE import_id = ? AND status IN ('draft', 'approved')""",
                    (target_import_id,),
                )
                unresolved = db.execute(
                    """SELECT COUNT(*) FROM playlist_entries e
                    JOIN resolutions r ON r.entry_id = e.id
                    WHERE e.import_id = ? AND r.state IN
                    ('pending', 'resolving', 'unresolved', 'ambiguous', 'validation_failed')""",
                    (target_import_id,),
                ).fetchone()[0]
                db.execute(
                    """UPDATE imports SET workflow_state = ?, updated_at = ? WHERE id = ?""",
                    (
                        "review_required" if unresolved else "ready_to_plan",
                        timestamp,
                        target_import_id,
                    ),
                )
        return len(selected)
