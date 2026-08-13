import logging
from pathlib import Path

from .config import Config
from .lidarr import LidarrClient
from .models import MusicBrainzResult, PlaylistInfo, Summary
from .musicbrainz import MusicBrainzClient
from .reports import (
    artist_additions,
    load_mapping_report,
    row_for,
    write_artist_impact_report,
    write_lidarr_action_report,
    write_matched_report,
    write_missing_report,
    write_playlist_overview,
    write_reports,
    write_resumed_matched_report,
    write_resumed_missing_report,
)
from .services import ResolutionProgress, ResolutionService
from .sources.base import MusicSource

logger = logging.getLogger(__name__)


def _print_summary(summary: Summary) -> None:
    print(
        f"\nSummary: {summary.total} tracks; {summary.resolved_by_isrc} via ISRC; "
        f"{summary.resolved_by_search} via search; {summary.unresolved} unresolved; "
        f"Lidarr {summary.lidarr_added} added, {summary.lidarr_updated} updated, "
        f"{summary.lidarr_skipped} skipped."
    )


def _print_artist_impact(
    mapping_path: Path, results: list[MusicBrainzResult], missing: dict[int, str]
) -> None:
    additions = artist_additions(results, missing)
    report = write_artist_impact_report(mapping_path, additions)
    print(f"\nArtist impact: {len(additions)} new artist{'s' if len(additions) != 1 else ''}")
    for artist in additions:
        print(
            f"  - {artist['artist_name']} ({artist['playlist_tracks']} playlist "
            f"track{'s' if artist['playlist_tracks'] != 1 else ''})"
        )
    print(f"Artist impact report: {report}")


def resume_lidarr(path: Path, config: Config, *, missing_in_lidarr: bool = False) -> Summary:
    if not config.lidarr_enabled:
        raise ValueError("--resume requires LIDARR_URL and LIDARR_API_KEY")
    results, rows, summary = load_mapping_report(path)
    print(f"Loaded {len(results)} tracks from mapping report: {path}")
    client = LidarrClient(config)
    if missing_in_lidarr:
        try:
            missing, matched = client.compare(results)
        except Exception as exc:
            raise RuntimeError(f"Could not compare cached playlist with Lidarr: {exc}") from exc
        missing_report = write_resumed_missing_report(path, rows, missing)
        matched_report = write_resumed_matched_report(path, rows, matched)
        print(f"Missing in Lidarr report: {missing_report} ({len(missing)} tracks)")
        print(f"Matched in Lidarr report: {matched_report} ({len(matched)} tracks)")
        _print_artist_impact(path, results, missing)
        print("Missing-in-Lidarr mode: Lidarr changes skipped.")
    else:
        actions = client.sync_planned(results, summary)
        action_report = write_lidarr_action_report(path, actions)
        print(f"Lidarr action report: {action_report} ({len(actions)} actions)")
    _print_summary(summary)
    return summary


def select_playlist(source: MusicSource) -> PlaylistInfo:
    playlists = source.list_playlists()
    print(f"\nAvailable {source.name.title()} playlists:\n")
    for index, playlist in enumerate(playlists):
        label = f"{playlist.path} / {playlist.name}" if playlist.path else playlist.name
        count = f" ({playlist.track_count} tracks)" if playlist.track_count is not None else ""
        print(f"[{index}] {label}{count}")
    while True:
        raw = input("\nChoose an index, or paste a playlist ID or URL: ").strip()
        if not raw:
            print("Please enter an index, playlist ID, or URL.")
        elif raw.isdigit() and int(raw) < len(playlists):
            return playlists[int(raw)]
        else:
            try:
                return source.get_playlist(raw)
            except Exception as exc:
                print(f"Could not open that playlist: {exc}")


def overview(source: MusicSource, config: Config) -> Path:
    """Build a read-only artist impact overview for every source playlist."""
    if not config.lidarr_enabled:
        raise ValueError("--overview requires LIDARR_URL and LIDARR_API_KEY")
    source.login()
    playlists = source.list_playlists()
    mb = MusicBrainzClient(
        config.mb_base_url,
        config.mb_user_agent,
        config.mb_request_delay,
        config.mb_timeout,
        config.mb_max_retries,
    )
    lidarr = LidarrClient(config)
    rows: list[dict[str, str | int]] = []
    resolved_tracks: dict[tuple[str, str], MusicBrainzResult] = {}
    print(f"\nScanning {len(playlists)} {source.name.title()} playlists (read-only)...")
    for number, playlist in enumerate(playlists, 1):
        label = f"{playlist.path} / {playlist.name}" if playlist.path else playlist.name
        if playlist.is_followed:
            print(f"[{number}/{len(playlists)}] {label}: skipped (followed playlist)")
            rows.append(
                {
                    "source": source.name,
                    "playlist": playlist.name,
                    "playlist_path": playlist.path or "",
                    "playlist_id": playlist.id,
                    "tracks": playlist.track_count or "",
                    "resolved_tracks": "",
                    "unresolved_tracks": "",
                    "artists_to_add": "",
                    "artist_names": "",
                    "status": "skipped_followed",
                }
            )
            continue
        logger.info("Scanning playlist %d/%d: %s", number, len(playlists), label)
        try:
            tracks = source.get_tracks(playlist)
            results = []
            for track in tracks:
                key = (track.source, track.source_track_id)
                if key not in resolved_tracks:
                    resolved_tracks[key] = mb.resolve(track)
                results.append(resolved_tracks[key])
            missing, _ = lidarr.compare(results)
            additions = artist_additions(results, missing)
            unresolved = sum(result.resolved_via is None for result in results)
            row: dict[str, str | int] = {
                "source": source.name,
                "playlist": playlist.name,
                "playlist_path": playlist.path or "",
                "playlist_id": playlist.id,
                "tracks": len(tracks),
                "resolved_tracks": len(tracks) - unresolved,
                "unresolved_tracks": unresolved,
                "artists_to_add": len(additions),
                "artist_names": "; ".join(str(item["artist_name"]) for item in additions),
                "status": "ok",
            }
            print(
                f"[{number}/{len(playlists)}] {label}: {len(additions)} new artist"
                f"{'s' if len(additions) != 1 else ''}"
                f"{(' — ' + str(row['artist_names'])) if additions else ''}"
            )
        except Exception as exc:
            print(f"[{number}/{len(playlists)}] {label}: skipped (scan error)")
            row = {
                "source": source.name,
                "playlist": playlist.name,
                "playlist_path": playlist.path or "",
                "playlist_id": playlist.id,
                "tracks": playlist.track_count or "",
                "resolved_tracks": "",
                "unresolved_tracks": "",
                "artists_to_add": "",
                "artist_names": "",
                "status": f"error: {exc}",
            }
        rows.append(row)
    report = write_playlist_overview(config.output_dir, source.name, rows)
    print(f"\nPlaylist overview: {report} ({len(rows)} playlists)")
    return report


def run(
    source: MusicSource, config: Config, *, dry_run: bool = False, missing_in_lidarr: bool = False
) -> Summary:
    if missing_in_lidarr and not config.lidarr_enabled:
        raise ValueError("--missing-in-lidarr requires LIDARR_URL and LIDARR_API_KEY")
    source.login()
    playlist = select_playlist(source)
    mapping, unresolved, results, rows, summary = resolve_playlist(source, config, playlist)
    print(
        f"\nMapping report: {mapping} ({len(rows)} tracks)\n"
        f"Unresolved report: {unresolved} ({summary.unresolved} tracks)"
    )
    if missing_in_lidarr:
        try:
            missing, matched = LidarrClient(config).compare(results)
        except Exception as exc:
            raise RuntimeError(f"Could not compare playlist with Lidarr: {exc}") from exc
        missing_report = write_missing_report(config.output_dir, playlist, rows, missing)
        matched_report = write_matched_report(config.output_dir, playlist, rows, matched)
        print(f"Missing in Lidarr report: {missing_report} ({len(missing)} tracks)")
        print(f"Matched in Lidarr report: {matched_report} ({len(matched)} tracks)")
        _print_artist_impact(mapping, results, missing)
        print("Missing-in-Lidarr mode: Lidarr changes skipped.")
    elif dry_run:
        print("Dry run: Lidarr changes skipped.")
    elif config.lidarr_enabled:
        actions = LidarrClient(config).sync_planned(results, summary)
        action_report = write_lidarr_action_report(mapping, actions)
        print(f"Lidarr action report: {action_report} ({len(actions)} actions)")
    else:
        print("Lidarr integration disabled (set LIDARR_URL and LIDARR_API_KEY to enable it).")
    _print_summary(summary)
    return summary


def resolve_playlist(
    source: MusicSource, config: Config, playlist: PlaylistInfo
) -> tuple[Path, Path, list[MusicBrainzResult], list[dict[str, str]], Summary]:
    """Resolve one already-selected playlist and persist its reusable mapping reports."""
    logger.info("Selected %s playlist: %s", source.name.title(), playlist.name)
    tracks = source.get_tracks(playlist)
    mb = MusicBrainzClient(
        config.mb_base_url,
        config.mb_user_agent,
        config.mb_request_delay,
        config.mb_timeout,
        config.mb_max_retries,
    )

    def report_progress(item: ResolutionProgress) -> None:
        logger.info("Resolving %d/%d: %s", item.current, item.total, item.track.title)

    batch = ResolutionService(mb).resolve_tracks(tracks, report_progress)
    results, summary = batch.results, batch.summary
    rows = [row_for(playlist, track, result) for track, result in zip(tracks, results)]
    for track, result in zip(tracks, results):
        if result.resolved_via is None:
            logger.warning(
                "Unresolved: %s — %s (%s)",
                ", ".join(track.artists),
                track.title,
                result.failure_reason,
            )
    mapping, unresolved = write_reports(config.output_dir, playlist, rows)
    return mapping, unresolved, results, rows, summary
