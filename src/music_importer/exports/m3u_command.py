"""Interactive command for selecting and exporting an M3U playlist."""

import argparse
import logging
from pathlib import Path

import requests

from ..config import load_config
from ..integrations.lidarr import LidarrClient
from ..integrations.sources.spotify import SpotifySource
from ..integrations.sources.tidal import TidalSource
from ..workflows.import_workflow import resolve_playlist
from ..workflows.selection import select_playlist
from .m3u import cached_mapping, default_output_path, export_m3u, missing_report_path


def _mapping(value: str) -> tuple[str, str]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("path maps must be LIDARR_PREFIX=PLAYER_PREFIX")
    source, target = value.split("=", 1)
    if not source:
        raise argparse.ArgumentTypeError("the Lidarr path prefix cannot be empty")
    return source.rstrip("/\\"), target.rstrip("/\\")


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
        written, missing = export_m3u(mapping, output, LidarrClient(config), args.path_map)
        print(f"M3U playlist: {output} ({written} tracks; {missing} not downloaded or unmatched)")
        print(f"Missing-track report: {missing_report_path(output)} ({missing} tracks)")
    except (ValueError, OSError, RuntimeError, requests.RequestException) as exc:
        parser.exit(1, f"Error: {exc}\n")
