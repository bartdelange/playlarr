import logging
from pathlib import Path

from ..config import Config
from ..domain.models import Summary
from ..exports.lidarr_reports import (
    write_lidarr_action_report,
    write_resumed_matched_report,
    write_resumed_missing_report,
)
from ..exports.mapping_report import load_mapping_report
from ..integrations.lidarr import LidarrClient
from .presentation import print_artist_impact, print_summary

logger = logging.getLogger(__name__)


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
        print_artist_impact(path, results, missing)
        print("Missing-in-Lidarr mode: Lidarr changes skipped.")
    else:
        actions = client.sync_planned(results, summary)
        action_report = write_lidarr_action_report(path, actions)
        print(f"Lidarr action report: {action_report} ({len(actions)} actions)")
    print_summary(summary)
    return summary
