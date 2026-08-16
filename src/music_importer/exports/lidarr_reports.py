"""Lidarr comparison and mutation-audit CSV reports."""

import csv
from pathlib import Path

from ..domain.models import PlaylistInfo
from .mapping_report import FIELDS, safe_filename

MISSING_FIELDS = [*FIELDS, "lidarr_missing_reason"]


MATCHED_FIELDS = [*FIELDS, "lidarr_match_reason"]


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


def write_missing_report(
    output_dir: Path, playlist: PlaylistInfo, rows: list[dict[str, str]], missing: dict[int, str]
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = safe_filename(f"{playlist.source}_{playlist.name}_{playlist.id}")
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
    stem = safe_filename(f"{playlist.source}_{playlist.name}_{playlist.id}")
    path = output_dir / f"{stem}_matched_in_lidarr.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=MATCHED_FIELDS)
        writer.writeheader()
        writer.writerows(
            {**rows[index], "lidarr_match_reason": reason} for index, reason in matched.items()
        )
    return path


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
