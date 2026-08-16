"""Artist-addition impact analysis and CSV output."""

import csv
from pathlib import Path

from ..domain.models import MusicBrainzResult

ARTIST_IMPACT_FIELDS = ["artist_name", "artist_mbid", "playlist_tracks"]


def artist_additions(
    results: list[MusicBrainzResult], missing: dict[int, str]
) -> list[dict[str, str | int]]:
    """Summarize unique artists that a Lidarr sync would need to create."""
    additions: dict[str, dict[str, str | int]] = {}
    for index, reason in missing.items():
        result = results[index]
        if reason != "artist_missing" or not result.primary_artist_id:
            continue
        artist = additions.setdefault(
            result.primary_artist_id,
            {
                "artist_name": result.artist_names[0]
                if result.artist_names
                else result.primary_artist_id,
                "artist_mbid": result.primary_artist_id,
                "playlist_tracks": 0,
            },
        )
        artist["playlist_tracks"] = int(artist["playlist_tracks"]) + 1
    return sorted(additions.values(), key=lambda item: str(item["artist_name"]).casefold())


def write_artist_impact_report(mapping_path: Path, additions: list[dict[str, str | int]]) -> Path:
    """Write the artist additions implied by a playlist mapping beside that mapping."""
    suffix = "_musicbrainz.csv"
    name = mapping_path.name
    stem = name[: -len(suffix)] if name.endswith(suffix) else mapping_path.stem
    path = mapping_path.with_name(f"{stem}_artist_impact.csv")
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=ARTIST_IMPACT_FIELDS)
        writer.writeheader()
        writer.writerows(additions)
    return path
