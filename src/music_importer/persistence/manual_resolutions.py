import json

from ..domain.models import MusicBrainzResult
from .timestamps import now


class ManualResolutionsRepository:
    def save_manual_resolution(
        self,
        entry_id: int,
        result: MusicBrainzResult,
        *,
        method: str,
        validation_status: str,
        evidence: dict | None = None,
        selected_release_group_id: str | None = None,
    ) -> None:
        if validation_status not in {"valid", "warning"}:
            raise ValueError("only validated manual mappings can be confirmed")
        if method not in {"manual_search", "manual_mbid", "imported_from_csv", "reused_manual"}:
            raise ValueError(f"invalid manual resolution method: {method}")
        timestamp = now()
        with self.connect() as db:
            owner = db.execute(
                "SELECT import_id FROM playlist_entries WHERE id = ?", (entry_id,)
            ).fetchone()
            if owner is None:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            cursor = db.execute(
                """UPDATE resolutions SET state = 'manually_resolved', method = ?,
                result_json = ?, evidence_json = ?, is_manual = 1, validation_status = ?,
                selected_release_group_id = ?, confirmed_at = ?, updated_at = ? WHERE entry_id = ?""",
                (
                    method,
                    self._result_json(result),
                    json.dumps(evidence or {}),
                    validation_status,
                    selected_release_group_id,
                    timestamp,
                    timestamp,
                    entry_id,
                ),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            db.execute(
                "UPDATE lidarr_plans SET status = 'superseded' "
                "WHERE import_id = ? AND status = 'draft'",
                (owner["import_id"],),
            )
            db.execute(
                "UPDATE imports SET workflow_state = 'ready_to_plan', updated_at = ? WHERE id = ?",
                (timestamp, owner["import_id"]),
            )

    def mark_skipped(self, entry_id: int) -> None:
        with self.connect() as db:
            owner = db.execute(
                "SELECT import_id FROM playlist_entries WHERE id = ?", (entry_id,)
            ).fetchone()
            if owner is None:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            cursor = db.execute(
                """UPDATE resolutions SET state = 'skipped', method = 'manual_skip',
                result_json = '{}', evidence_json = ?, is_manual = 1,
                validation_status = NULL, confirmed_at = ?, updated_at = ? WHERE entry_id = ?""",
                (json.dumps({"manual_action": "skip"}), now(), now(), entry_id),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            db.execute(
                "UPDATE lidarr_plans SET status = 'superseded' "
                "WHERE import_id = ? AND status = 'draft'",
                (owner["import_id"],),
            )

    def mark_validation_failed(self, entry_id: int, errors: tuple[str, ...]) -> None:
        with self.connect() as db:
            current = db.execute(
                "SELECT is_manual FROM resolutions WHERE entry_id = ?", (entry_id,)
            ).fetchone()
            if current is None:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            if current["is_manual"]:
                return
            db.execute(
                """UPDATE resolutions SET state = 'validation_failed',
                validation_status = 'invalid', evidence_json = ?, updated_at = ?
                WHERE entry_id = ?""",
                (json.dumps({"errors": errors}), now(), entry_id),
            )

    def clear_manual_resolution(self, entry_id: int) -> None:
        with self.connect() as db:
            cursor = db.execute(
                """UPDATE resolutions SET state = 'pending', method = NULL,
                result_json = '{}', evidence_json = '{}', is_manual = 0,
                validation_status = NULL, selected_release_group_id = NULL,
                confirmed_at = NULL, updated_at = ? WHERE entry_id = ?""",
                (now(), entry_id),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"unknown playlist entry: {entry_id}")

    def set_various_artists_override(self, entry_id: int, allowed: bool) -> None:
        """Persist an explicit per-track exception to the VA safety policy."""
        timestamp = now()
        with self.connect() as db:
            row = db.execute(
                """SELECT e.import_id, r.evidence_json
                FROM playlist_entries e JOIN resolutions r ON r.entry_id = e.id
                WHERE e.id = ?""",
                (entry_id,),
            ).fetchone()
            if row is None:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            evidence = json.loads(row["evidence_json"] or "{}")
            if allowed:
                evidence["allow_various_artists_release"] = True
            else:
                evidence.pop("allow_various_artists_release", None)
            db.execute(
                "UPDATE resolutions SET evidence_json = ?, updated_at = ? WHERE entry_id = ?",
                (json.dumps(evidence), timestamp, entry_id),
            )
            db.execute(
                "UPDATE lidarr_plans SET status = 'superseded' "
                "WHERE import_id = ? AND status = 'draft'",
                (row["import_id"],),
            )
            db.execute(
                "UPDATE imports SET workflow_state = 'ready_to_plan', updated_at = ? WHERE id = ?",
                (timestamp, row["import_id"]),
            )
