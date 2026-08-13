import argparse
import csv
import logging
from pathlib import Path

import requests

from .config import load_config
from .lidarr import LidarrClient
from .models import SourceTrack
from .navidrome import NavidromeClient
from .reports import load_mapping_report
from .services import PlaylistExportResult, PlaylistExportService
from .sources.spotify import SpotifySource
from .sources.tidal import TidalSource
from .workflow import resolve_playlist, select_playlist

MISSING_FIELDS = [
    "navidrome_search",
    "artists",
    "track_title",
    "album",
    "isrc",
    "mb_artist_names",
    "mb_recording_title",
    "missing_reason",
]


def _mapping(value: str) -> tuple[str, str]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("path maps must be LIDARR_PREFIX=PLAYER_PREFIX")
    source, target = value.split("=", 1)
    if not source:
        raise argparse.ArgumentTypeError("the Lidarr path prefix cannot be empty")
    return source.rstrip("/\\"), target.rstrip("/\\")


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


def cached_mapping(output_dir: Path, source: str, playlist_id: str) -> Path | None:
    candidates = list(output_dir.glob(f"{source}_*_{playlist_id}_musicbrainz.csv"))
    return max(candidates, key=lambda path: path.stat().st_mtime) if candidates else None


def choose_source() -> str:
    print("Choose a source:\n\n[0] TIDAL\n[1] Spotify")
    while True:
        value = input("\nChoose an index: ").strip().lower()
        if value in {"0", "tidal"}:
            return "tidal"
        if value in {"1", "spotify"}:
            return "spotify"
        print("Please choose 0 or 1.")


def select_or_resolve_mapping(config, source_name: str) -> Path:
    source = (
        TidalSource(config.tidal_session_file)
        if source_name == "tidal"
        else SpotifySource(
            config.spotify_client_id, config.spotify_redirect_uri, config.spotify_token_cache
        )
    )
    source.login()
    playlist = select_playlist(source)
    cached = cached_mapping(config.output_dir, source.name, playlist.id)
    if cached:
        print(f"Using cached mapping: {cached}")
        return cached
    mapping, unresolved, _, rows, summary = resolve_playlist(source, config, playlist)
    print(
        f"\nMapping report: {mapping} ({len(rows)} tracks)\n"
        f"Unresolved report: {unresolved} ({summary.unresolved} tracks)"
    )
    return mapping


def export_m3u(
    mapping_path: Path,
    output_path: Path,
    client: LidarrClient,
    path_mappings: list[tuple[str, str]],
    navidrome: NavidromeClient | None = None,
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
    export = PlaylistExportService(client, navidrome).build(tracks, results, path_mappings)
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
            artist = "; ".join(item.track.artists)
            title = item.track.title
            writer.writerow(
                {
                    "navidrome_search": " ".join(value for value in (artist, title) if value),
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


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create an M3U playlist from a Music Importer mapping and downloaded Lidarr files"
    )
    parser.add_argument("mapping", nargs="?", type=Path, metavar="MAPPING_CSV")
    parser.add_argument(
        "--source",
        choices=("tidal", "spotify"),
        help="source to browse when MAPPING_CSV is omitted",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="output path (default: beside the mapping report with an .m3u8 extension)",
    )
    parser.add_argument(
        "--path-map",
        action="append",
        type=_mapping,
        default=[],
        metavar="LIDARR_PREFIX=PLAYER_PREFIX",
        help="rewrite a Lidarr file path prefix; may be repeated",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s: %(message)s"
    )
    try:
        config = load_config()
        if not config.lidarr_enabled:
            raise ValueError("M3U export requires LIDARR_URL and LIDARR_API_KEY")
        mapping = args.mapping or select_or_resolve_mapping(config, args.source or choose_source())
        output = args.output or default_output_path(mapping)
        navidrome = NavidromeClient(config) if config.navidrome_enabled else None
        written, missing = export_m3u(
            mapping, output, LidarrClient(config), args.path_map, navidrome
        )
        print(f"M3U playlist: {output} ({written} tracks; {missing} not downloaded or unmatched)")
        print(f"Missing-track report: {missing_report_path(output)} ({missing} tracks)")
    except (ValueError, OSError, RuntimeError, requests.RequestException) as exc:
        parser.exit(1, f"Error: {exc}\n")


if __name__ == "__main__":
    main()
