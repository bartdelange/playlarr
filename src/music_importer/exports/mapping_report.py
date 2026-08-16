"""MusicBrainz mapping CSV serialization and resume loading."""

import csv
import re
from pathlib import Path

from ..domain.models import MusicBrainzResult, PlaylistInfo, SourceTrack, Summary

FIELDS = [
    "source",
    "source_playlist_id",
    "source_track_id",
    "track_title",
    "artists",
    "album",
    "isrc",
    "resolved_via",
    "mb_recording_title",
    "mb_artist_names",
    "mb_recording_ids",
    "mb_release_ids",
    "mb_release_group_ids",
    "mb_artist_ids",
    "mb_primary_artist_id",
    "failure_reason",
    "duration_ms",
]


RESUME_FIELDS = {"resolved_via", "mb_release_group_ids", "mb_primary_artist_id"}


def safe_filename(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-._")
    return value[:80] or "playlist"


def row_for(
    playlist: PlaylistInfo, track: SourceTrack, result: MusicBrainzResult
) -> dict[str, str]:
    return {
        "source": track.source,
        "source_playlist_id": playlist.id,
        "source_track_id": track.source_track_id,
        "track_title": track.title,
        "artists": "; ".join(track.artists),
        "album": track.album,
        "isrc": (track.isrc or "").replace("-", "").strip().upper(),
        "resolved_via": result.resolved_via or "none",
        "mb_recording_title": result.recording_title,
        "mb_artist_names": "; ".join(result.artist_names),
        "mb_recording_ids": ";".join(result.recording_ids),
        "mb_release_ids": ";".join(result.release_ids),
        "mb_release_group_ids": ";".join(result.release_group_ids),
        "mb_artist_ids": ";".join(result.artist_ids),
        "mb_primary_artist_id": result.primary_artist_id or "",
        "failure_reason": result.failure_reason,
        "duration_ms": str(track.duration_ms) if track.duration_ms is not None else "",
    }


def write_reports(
    output_dir: Path, playlist: PlaylistInfo, rows: list[dict[str, str]]
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = safe_filename(f"{playlist.source}_{playlist.name}_{playlist.id}")
    mapping = output_dir / f"{stem}_musicbrainz.csv"
    unresolved = output_dir / f"{stem}_unresolved.csv"
    for path, selected in (
        (mapping, rows),
        (unresolved, [row for row in rows if row["resolved_via"] == "none"]),
    ):
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(selected)
    return mapping, unresolved


def load_mapping_report(
    path: Path,
) -> tuple[list[MusicBrainzResult], list[dict[str, str]], Summary]:
    """Recreate the Lidarr inputs from a previously written mapping report."""
    try:
        with path.open(newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            missing = RESUME_FIELDS.difference(reader.fieldnames or ())
            if missing:
                raise ValueError(f"mapping CSV is missing columns: {', '.join(sorted(missing))}")
            rows = list(reader)
    except FileNotFoundError as exc:
        raise ValueError(f"mapping CSV does not exist: {path}") from exc
    except (OSError, csv.Error) as exc:
        raise ValueError(f"could not read mapping CSV {path}: {exc}") from exc

    results = []
    summary = Summary(total=len(rows))
    for row in rows:
        via = (row.get("resolved_via") or "").strip()
        result = MusicBrainzResult(
            resolved_via=None if via in {"", "none"} else via,
            recording_title=(row.get("mb_recording_title") or "").strip(),
            recording_ids=tuple(
                value.strip()
                for value in (row.get("mb_recording_ids") or "").split(";")
                if value.strip()
            ),
            artist_names=tuple(
                value.strip()
                for value in (row.get("mb_artist_names") or "").split(";")
                if value.strip()
            ),
            release_group_ids=tuple(
                value.strip()
                for value in (row.get("mb_release_group_ids") or "").split(";")
                if value.strip()
            ),
            primary_artist_id=(row.get("mb_primary_artist_id") or "").strip() or None,
        )
        results.append(result)
        if result.resolved_via == "isrc":
            summary.resolved_by_isrc += 1
        elif result.resolved_via:
            summary.resolved_by_search += 1
        else:
            summary.unresolved += 1
    return results, rows, summary
