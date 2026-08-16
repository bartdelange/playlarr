"""Ordered M3U playlist construction and serialization."""

import csv
from pathlib import Path

from ..application.playlist_export import PlaylistExportResult, PlaylistExportService
from ..domain.models import SourceTrack
from ..integrations.lidarr import LidarrClient
from .mapping_report import load_mapping_report

MISSING_FIELDS = [
    "artists",
    "track_title",
    "album",
    "isrc",
    "mb_artist_names",
    "mb_recording_title",
    "missing_reason",
]


def translate_path(path: str, mappings: list[tuple[str, str]]) -> str:
    return PlaylistExportService._translate(path, mappings)


def default_output_path(mapping_path: Path) -> Path:
    suffix = "_musicbrainz.csv"
    stem = (
        mapping_path.name[: -len(suffix)]
        if mapping_path.name.endswith(suffix)
        else mapping_path.stem
    )
    return mapping_path.with_name(f"{stem}.m3u8")


def missing_report_path(output_path: Path) -> Path:
    return output_path.with_name(f"{output_path.stem}_missing.csv")


def playlist_output_path(output_dir: Path, playlist_name: str) -> Path:
    safe_name = "".join(
        character if character.isalnum() or character in "-_" else "-"
        for character in playlist_name
    ).strip("-")
    return output_dir / f"{safe_name or 'playlist'}.m3u8"


def cached_mapping(output_dir: Path, source: str, playlist_id: str) -> Path | None:
    candidates = list(output_dir.glob(f"{source}_*_{playlist_id}_musicbrainz.csv"))
    return max(candidates, key=lambda path: path.stat().st_mtime) if candidates else None


def export_m3u(
    mapping_path: Path,
    output_path: Path,
    client: LidarrClient,
    path_mappings: list[tuple[str, str]],
) -> tuple[int, int]:
    results, rows, _ = load_mapping_report(mapping_path)
    tracks = [
        SourceTrack(
            source=row.get("source") or "",
            source_track_id=row.get("source_track_id") or "",
            title=row.get("track_title") or row.get("mb_recording_title") or "",
            artists=tuple(
                value.strip()
                for value in (row.get("artists") or row.get("mb_artist_names") or "").split(";")
                if value.strip()
            ),
            album=row.get("album") or "",
            isrc=row.get("isrc") or None,
            duration_ms=(
                int(row["duration_ms"]) if (row.get("duration_ms") or "").isdigit() else None
            ),
        )
        for row in rows
    ]
    export = PlaylistExportService(client).build(tracks, results, path_mappings)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("#EXTM3U\n")
        for entry in export.entries:
            label = " - ".join(
                value.replace("\n", " ") for value in (entry.artist, entry.title) if value
            )
            handle.write(f"#EXTINF:-1,{label}\n")
            handle.write(f"{entry.path}\n")

    with missing_report_path(output_path).open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=MISSING_FIELDS)
        writer.writeheader()
        for item in export.missing:
            row = rows[item.position]
            writer.writerow(
                {
                    "artists": row.get("artists") or "",
                    "track_title": row.get("track_title") or "",
                    "album": row.get("album") or "",
                    "isrc": row.get("isrc") or "",
                    "mb_artist_names": row.get("mb_artist_names") or "",
                    "mb_recording_title": row.get("mb_recording_title") or "",
                    "missing_reason": item.reason,
                }
            )
    return len(export.entries), len(export.missing)


def write_m3u(output_path: Path, export: PlaylistExportResult) -> None:
    """Write a service-produced playlist without requiring an intermediate CSV."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("#EXTM3U\n")
        for entry in export.entries:
            label = " - ".join(
                value.replace("\n", " ") for value in (entry.artist, entry.title) if value
            )
            handle.write(f"#EXTINF:-1,{label}\n{entry.path}\n")
