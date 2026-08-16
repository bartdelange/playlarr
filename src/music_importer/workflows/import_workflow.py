import logging
from pathlib import Path

from ..application.resolution import ResolutionProgress, ResolutionService
from ..config import Config
from ..domain.models import MusicBrainzResult, PlaylistInfo, Summary
from ..exports.lidarr_reports import (
    write_lidarr_action_report,
    write_matched_report,
    write_missing_report,
)
from ..exports.mapping_report import row_for, write_reports
from ..integrations.lidarr import LidarrClient
from ..integrations.musicbrainz import MusicBrainzClient
from ..integrations.sources.base import MusicSource
from .presentation import print_artist_impact, print_summary
from .selection import select_playlist

logger = logging.getLogger(__name__)


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
        print_artist_impact(mapping, results, missing)
        print("Missing-in-Lidarr mode: Lidarr changes skipped.")
    elif dry_run:
        print("Dry run: Lidarr changes skipped.")
    elif config.lidarr_enabled:
        actions = LidarrClient(config).sync_planned(results, summary)
        action_report = write_lidarr_action_report(mapping, actions)
        print(f"Lidarr action report: {action_report} ({len(actions)} actions)")
    else:
        print("Lidarr integration disabled (set LIDARR_URL and LIDARR_API_KEY to enable it).")
    print_summary(summary)
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
