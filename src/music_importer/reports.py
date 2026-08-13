import csv
import re
from pathlib import Path

from .models import MusicBrainzResult, PlaylistInfo, SourceTrack, Summary

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
MISSING_FIELDS = [*FIELDS, "lidarr_missing_reason"]
MATCHED_FIELDS = [*FIELDS, "lidarr_match_reason"]
RESUME_FIELDS = {"resolved_via", "mb_release_group_ids", "mb_primary_artist_id"}
LIDARR_ACTION_FIELDS = [
    "mapped_artist_names",
    "artist_name",
    "artist_mbid",
    "artist_lidarr_url",
    "release_group_id",
    "album_title",
    "album_lidarr_url",
    "action",
    "outcome",
    "details",
]
ARTIST_IMPACT_FIELDS = ["artist_name", "artist_mbid", "playlist_tracks"]
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


def _safe(value: str) -> str:
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
    stem = _safe(f"{playlist.source}_{playlist.name}_{playlist.id}")
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


def write_missing_report(
    output_dir: Path, playlist: PlaylistInfo, rows: list[dict[str, str]], missing: dict[int, str]
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = _safe(f"{playlist.source}_{playlist.name}_{playlist.id}")
    path = output_dir / f"{stem}_missing_in_lidarr.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=MISSING_FIELDS)
        writer.writeheader()
        writer.writerows(
            {**rows[index], "lidarr_missing_reason": reason} for index, reason in missing.items()
        )
    return path


def write_matched_report(
    output_dir: Path, playlist: PlaylistInfo, rows: list[dict[str, str]], matched: dict[int, str]
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = _safe(f"{playlist.source}_{playlist.name}_{playlist.id}")
    path = output_dir / f"{stem}_matched_in_lidarr.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=MATCHED_FIELDS)
        writer.writeheader()
        writer.writerows(
            {**rows[index], "lidarr_match_reason": reason} for index, reason in matched.items()
        )
    return path


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


def write_playlist_overview(
    output_dir: Path, source: str, rows: list[dict[str, str | int]]
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{_safe(source)}_playlist_overview.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=PLAYLIST_OVERVIEW_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    return path


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


def write_resumed_missing_report(
    mapping_path: Path, rows: list[dict[str, str]], missing: dict[int, str]
) -> Path:
    """Write a missing report beside a cached mapping, preserving its original stem."""
    suffix = "_musicbrainz.csv"
    name = mapping_path.name
    stem = name[: -len(suffix)] if name.endswith(suffix) else mapping_path.stem
    path = mapping_path.with_name(f"{stem}_missing_in_lidarr.csv")
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=MISSING_FIELDS)
        writer.writeheader()
        writer.writerows(
            {**rows[index], "lidarr_missing_reason": reason} for index, reason in missing.items()
        )
    return path


def write_resumed_matched_report(
    mapping_path: Path, rows: list[dict[str, str]], matched: dict[int, str]
) -> Path:
    suffix = "_musicbrainz.csv"
    name = mapping_path.name
    stem = name[: -len(suffix)] if name.endswith(suffix) else mapping_path.stem
    path = mapping_path.with_name(f"{stem}_matched_in_lidarr.csv")
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=MATCHED_FIELDS)
        writer.writeheader()
        writer.writerows(
            {**rows[index], "lidarr_match_reason": reason} for index, reason in matched.items()
        )
    return path


def write_lidarr_action_report(mapping_path: Path, actions: list[dict[str, str]]) -> Path:
    """Write the durable Lidarr mutation audit beside a mapping report."""
    suffix = "_musicbrainz.csv"
    name = mapping_path.name
    stem = name[: -len(suffix)] if name.endswith(suffix) else mapping_path.stem
    path = mapping_path.with_name(f"{stem}_lidarr_actions.csv")
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=LIDARR_ACTION_FIELDS)
        writer.writeheader()
        writer.writerows(actions)
    return path
