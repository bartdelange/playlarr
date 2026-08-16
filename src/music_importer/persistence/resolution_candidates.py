import json
from dataclasses import asdict

from ..domain.models import MusicBrainzCandidate
from .timestamps import now


class ResolutionCandidatesRepository:
    def save_candidates(self, entry_id: int, candidates: list[MusicBrainzCandidate]) -> None:
        with self.connect() as db:
            db.execute("DELETE FROM resolution_candidates WHERE entry_id = ?", (entry_id,))
            for position, candidate in enumerate(candidates):
                payload = asdict(candidate)
                db.execute(
                    """INSERT INTO resolution_candidates
                    (entry_id, position, candidate_json, created_at) VALUES (?, ?, ?, ?)""",
                    (entry_id, position, json.dumps(payload), now()),
                )
