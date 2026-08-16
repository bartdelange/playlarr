import json
from dataclasses import asdict

from ..domain.models import MusicBrainzResult
from .timestamps import now


class AutomaticResolutionsRepository:
    @staticmethod
    def _result_json(result: MusicBrainzResult) -> str:
        payload = asdict(result)
        for key, value in payload.items():
            if isinstance(value, tuple):
                payload[key] = list(value)
        return json.dumps(payload)

    def save_automatic_resolution(
        self, entry_id: int, result: MusicBrainzResult, *, evidence: dict | None = None
    ) -> bool:
        """Persist automation unless a human-confirmed mapping owns the entry."""
        state = "automatically_resolved" if result.resolved_via else "unresolved"
        with self.connect() as db:
            current = db.execute(
                "SELECT is_manual FROM resolutions WHERE entry_id = ?", (entry_id,)
            ).fetchone()
            if current is None:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            if current["is_manual"]:
                return False
            db.execute(
                """UPDATE resolutions SET state = ?, method = ?, result_json = ?,
                evidence_json = ?, validation_status = NULL, updated_at = ? WHERE entry_id = ?""",
                (
                    state,
                    result.resolved_via,
                    self._result_json(result),
                    json.dumps(evidence or {}),
                    now(),
                    entry_id,
                ),
            )
        return True

    def mark_resolving(self, entry_id: int) -> bool:
        with self.connect() as db:
            current = db.execute(
                "SELECT is_manual FROM resolutions WHERE entry_id = ?", (entry_id,)
            ).fetchone()
            if current is None:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            if current["is_manual"]:
                return False
            db.execute(
                "UPDATE resolutions SET state = 'resolving', updated_at = ? WHERE entry_id = ?",
                (now(), entry_id),
            )
        return True

    def save_imported_resolution(self, entry_id: int, result: MusicBrainzResult) -> None:
        state = "automatically_resolved" if result.resolved_via else "unresolved"
        with self.connect() as db:
            cursor = db.execute(
                """UPDATE resolutions SET state = ?, method = 'imported_from_csv',
                result_json = ?, evidence_json = ?, is_manual = 0, validation_status = NULL,
                updated_at = ? WHERE entry_id = ?""",
                (
                    state,
                    self._result_json(result),
                    json.dumps({"source": "mapping_csv"}),
                    now(),
                    entry_id,
                ),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"unknown playlist entry: {entry_id}")
