import logging
from pathlib import Path

from ..config import Config
from ..domain.models import MusicBrainzResult
from ..exports.artist_impact import artist_additions
from ..exports.playlist_overview import write_playlist_overview
from ..integrations.lidarr import LidarrClient
from ..integrations.musicbrainz import MusicBrainzClient
from ..integrations.sources.base import MusicSource

logger = logging.getLogger(__name__)


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
