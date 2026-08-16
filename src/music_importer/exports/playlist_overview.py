"""Cross-playlist overview CSV output."""

import csv
from pathlib import Path

from .mapping_report import safe_filename

PLAYLIST_OVERVIEW_FIELDS = [
    "source",
    "playlist",
    "playlist_path",
    "playlist_id",
    "tracks",
    "resolved_tracks",
    "unresolved_tracks",
    "artists_to_add",
    "artist_names",
    "status",
]


def write_playlist_overview(
    output_dir: Path, source: str, rows: list[dict[str, str | int]]
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{safe_filename(source)}_playlist_overview.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=PLAYLIST_OVERVIEW_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    return path
