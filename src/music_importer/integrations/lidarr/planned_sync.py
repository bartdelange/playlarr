import logging

from ...domain.models import (
    MusicBrainzResult,
    Summary,
)

logger = logging.getLogger("music_importer.integrations.lidarr.client")


class PlannedSyncClient:
    def sync_planned(
        self, results: list[MusicBrainzResult], summary: Summary
    ) -> list[dict[str, str]]:
        """Compatibility facade over the same plan/execute APIs used by the GUI."""
        plan = self.plan(results)
        execution = self.execute_plan(plan)
        created_artists = {
            item.action.artist_mbid
            for item in execution
            if item.action.action == "create_artist" and item.outcome == "created"
        }
        updated_artists = {
            item.action.artist_mbid
            for item in execution
            if item.action.action in {"monitor_artist", "monitor_release"}
            and item.outcome == "updated"
        } - created_artists
        represented_artists = {action.artist_mbid for action in plan.actions if action.artist_mbid}
        failed_artists = {item.action.artist_mbid for item in execution if item.outcome == "failed"}
        summary.lidarr_added += len(created_artists)
        summary.lidarr_updated += len(updated_artists)
        summary.lidarr_skipped += len(
            (represented_artists - created_artists - updated_artists) | failed_artists
        )
        configured_url = (self.config.lidarr_url or "").rstrip("/")
        action_names = {
            "create_artist": "add_artist",
            "create_release": "add_album",
            "monitor_release": "monitor_album",
            "queue_search": "search_album",
            "reuse_downloaded_release": "consolidate_release",
        }
        return [
            {
                "mapped_artist_names": item.action.artist_name,
                "artist_name": item.action.artist_name,
                "artist_mbid": item.action.artist_mbid,
                "artist_lidarr_url": (
                    f"{configured_url}/artist/{item.action.artist_mbid}"
                    if configured_url and item.action.artist_mbid
                    else ""
                ),
                "release_group_id": item.action.release_group_id,
                "album_title": item.action.album_title,
                "album_lidarr_url": (
                    f"{configured_url}/album/{item.action.release_group_id}"
                    if configured_url and item.action.release_group_id
                    else ""
                ),
                "action": action_names.get(item.action.action, item.action.action),
                "outcome": item.outcome,
                "details": item.details or item.action.reason,
            }
            for item in execution
        ]
