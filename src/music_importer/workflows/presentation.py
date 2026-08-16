import logging
from pathlib import Path

from ..domain.models import MusicBrainzResult, Summary
from ..exports.artist_impact import artist_additions, write_artist_impact_report

logger = logging.getLogger(__name__)


def print_summary(summary: Summary) -> None:
    print(
        f"\nSummary: {summary.total} tracks; {summary.resolved_by_isrc} via ISRC; "
        f"{summary.resolved_by_search} via search; {summary.unresolved} unresolved; "
        f"Lidarr {summary.lidarr_added} added, {summary.lidarr_updated} updated, "
        f"{summary.lidarr_skipped} skipped."
    )


def print_artist_impact(
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
