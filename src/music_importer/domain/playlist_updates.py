import hashlib
import json
from collections.abc import Iterable

from .models import AcquiredTrack


def playlist_snapshot_token(entries: Iterable[AcquiredTrack]) -> str:
    """Fingerprint the source fields that determine a playlist update preview."""
    payload = [
        (
            entry.position,
            entry.track.source_track_id,
            entry.track.title,
            entry.track.artists,
            entry.track.album,
            entry.track.isrc,
            entry.track.duration_ms,
            entry.skip_reason,
        )
        for entry in entries
    ]
    encoded = json.dumps(payload, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()
