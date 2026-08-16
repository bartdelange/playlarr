import logging
from collections import defaultdict

import requests

from ...domain.models import (
    MusicBrainzResult,
    Summary,
)
from .matching import (
    _VARIOUS_ARTISTS_MBID,
    _downloaded_album_group,
    _downloaded_track_keys,
    _is_various_artists_album,
    _represented_by_download,
)

logger = logging.getLogger("music_importer.integrations.lidarr.client")


class LegacySyncClient:
    def sync(self, results: list[MusicBrainzResult], summary: Summary) -> list[dict[str, str]]:
        """Previous implementation retained briefly as a refactor reference."""
        actions: list[dict[str, str]] = []

        def record(
            artist_mbid: str,
            artist_name: str,
            action: str,
            outcome: str,
            *,
            album: dict | None = None,
            release_group: str = "",
            mapped_artist_names: str = "",
            details: str = "",
        ) -> None:
            release_group_id = release_group or (album or {}).get("foreignAlbumId", "")
            configured_url = getattr(self.config, "lidarr_url", "")
            base_url = configured_url.rstrip("/") if isinstance(configured_url, str) else ""
            actions.append(
                {
                    "mapped_artist_names": mapped_artist_names,
                    "artist_name": artist_name,
                    "artist_mbid": artist_mbid,
                    "artist_lidarr_url": f"{base_url}/artist/{artist_mbid}" if artist_mbid else "",
                    "release_group_id": release_group_id,
                    "album_title": (album or {}).get("title", ""),
                    "album_lidarr_url": (
                        f"{base_url}/album/{release_group_id}" if release_group_id else ""
                    ),
                    "action": action,
                    "outcome": outcome,
                    "details": details,
                }
            )

        grouped_results: dict[str, list[MusicBrainzResult]] = defaultdict(list)
        for result in results:
            is_various_artists = result.primary_artist_id == _VARIOUS_ARTISTS_MBID or any(
                name.casefold() == "various artists" for name in result.artist_names
            )
            if is_various_artists and result.release_group_ids:
                record(
                    result.primary_artist_id or "",
                    "Various Artists",
                    "skip_artist",
                    "skipped",
                    details="Various Artists is excluded",
                )
            if result.primary_artist_id and result.release_group_ids and not is_various_artists:
                grouped_results[result.primary_artist_id].append(result)
        try:
            existing = {
                artist.get("foreignArtistId"): artist
                for artist in self._request("GET", "artist") or []
            }
        except requests.RequestException as exc:
            logger.error("Could not read artists from Lidarr: %s", exc)
            summary.lidarr_skipped += len(grouped_results)
            record("", "", "read_artists", "failed", details=str(exc))
            return actions
        # Albums are globally unique in Lidarr. A release group from a compilation
        # can already exist under an album artist other than the track's primary artist.
        known_albums: dict[str, dict] = {}
        for artist_mbid, artist_results in grouped_results.items():
            try:
                artist = existing.get(artist_mbid)
                artist_was_added = artist is None
                mapped_artist_names = "; ".join(
                    dict.fromkeys(name for result in artist_results for name in result.artist_names)
                )
                mapped_release_groups = {
                    release_group
                    for result in artist_results
                    for release_group in result.release_group_ids
                }
                if artist_was_added:
                    artist = (
                        self._request(
                            "POST",
                            "artist",
                            json=self._artist_payload(artist_mbid, mapped_release_groups),
                        )
                        or {}
                    )
                    if artist.get("id") is None:
                        raise RuntimeError(
                            f"Lidarr did not return the created artist {artist_mbid}"
                        )
                    summary.lidarr_added += 1
                artist_name = artist.get("artistName") or artist_mbid
                if artist_was_added:
                    record(
                        artist_mbid,
                        artist_name,
                        "add_artist",
                        "created",
                        mapped_artist_names=mapped_artist_names,
                    )
                tracks = self._request("GET", "track", params={"artistId": artist["id"]}) or []
                recording_ids, titles = _downloaded_track_keys(tracks)
                albums = self._request("GET", "album", params={"artistId": artist["id"]}) or []
                albums_by_mbid = {album.get("foreignAlbumId"): album for album in albums}
                albums_by_id = {
                    album["id"]: album for album in albums if album.get("id") is not None
                }
                requested_release_groups: set[str] = set()
                search_release_groups: set[str] = set()
                consolidated: list[tuple[MusicBrainzResult, str]] = []
                for result in artist_results:
                    downloaded_group = _downloaded_album_group(result, tracks, albums_by_id)
                    if downloaded_group:
                        requested_release_groups.add(downloaded_group)
                        if downloaded_group not in result.release_group_ids:
                            consolidated.append((result, downloaded_group))
                    else:
                        requested_release_groups.update(result.release_group_ids)
                        if not _represented_by_download(result, recording_ids, titles):
                            search_release_groups.update(result.release_group_ids)
                logger.info(
                    "Adding songs for %s (%d requested release%s)",
                    artist_name,
                    len(requested_release_groups),
                    "" if len(requested_release_groups) == 1 else "s",
                )
                for result, downloaded_group in consolidated:
                    record(
                        artist_mbid,
                        artist_name,
                        "consolidate_release",
                        "reused",
                        release_group=downloaded_group,
                        mapped_artist_names=mapped_artist_names,
                        details=(
                            "downloaded recording already belongs to this Lidarr album; "
                            f"mapped candidates: {', '.join(result.release_group_ids)}"
                        ),
                    )
                known_albums.update(albums_by_mbid)
                for release_group in sorted(requested_release_groups - albums_by_mbid.keys()):
                    album = known_albums.get(release_group)
                    if album is None:
                        matches = (
                            self._request("GET", "album", params={"foreignAlbumId": release_group})
                            or []
                        )
                        album = next(
                            (
                                item
                                for item in matches
                                if item.get("foreignAlbumId") == release_group
                            ),
                            None,
                        )
                    if album is not None and _is_various_artists_album(album):
                        record(
                            artist_mbid,
                            artist_name,
                            "skip_album",
                            "skipped",
                            album=album,
                            release_group=release_group,
                            mapped_artist_names=mapped_artist_names,
                            details="release group belongs to Various Artists",
                        )
                        continue
                    if album is None:
                        album = self._add_album(artist, release_group)
                        if album is None:
                            record(
                                artist_mbid,
                                artist_name,
                                "skip_album",
                                "skipped",
                                release_group=release_group,
                                mapped_artist_names=mapped_artist_names,
                                details="album lookup belongs to Various Artists",
                            )
                            continue
                        record(
                            artist_mbid,
                            artist_name,
                            "add_album",
                            "created",
                            album=album,
                            release_group=release_group,
                            mapped_artist_names=mapped_artist_names,
                        )
                    if album.get("id") is not None:
                        known_albums[release_group] = album
                        albums_by_mbid[release_group] = album
                selected = [
                    albums_by_mbid[release_group]
                    for release_group in sorted(requested_release_groups)
                    if release_group in albums_by_mbid
                    and not albums_by_mbid[release_group].get("monitored")
                ]
                if selected:
                    logger.info(
                        "Monitoring for %s: %s",
                        artist_name,
                        ", ".join(
                            album.get("title") or album["foreignAlbumId"] for album in selected
                        ),
                    )
                    for album in selected:
                        album["monitored"] = True
                    self._request(
                        "PUT",
                        "album/monitor",
                        json={"albumIds": [a["id"] for a in selected], "monitored": True},
                    )
                    for album in selected:
                        record(
                            artist_mbid,
                            artist_name,
                            "monitor_album",
                            "updated",
                            album=album,
                            mapped_artist_names=mapped_artist_names,
                        )
                requested = [
                    albums_by_mbid[release_group]
                    for release_group in sorted(requested_release_groups)
                    if release_group in albums_by_mbid
                ]
                to_search = [
                    album
                    for album in (requested if artist_was_added else selected)
                    if album.get("foreignAlbumId") in search_release_groups
                ]
                if to_search:
                    logger.info(
                        "Searching for %s: %s",
                        artist_name,
                        ", ".join(
                            album.get("title") or album["foreignAlbumId"] for album in to_search
                        ),
                    )
                    self._request(
                        "POST",
                        "command",
                        json={
                            "name": "AlbumSearch",
                            "albumIds": [album["id"] for album in to_search],
                        },
                    )
                    for album in to_search:
                        record(
                            artist_mbid,
                            artist_name,
                            "search_album",
                            "queued",
                            album=album,
                            mapped_artist_names=mapped_artist_names,
                        )
                artist_changed = self._monitor_artist(artist)
                if artist_changed:
                    record(
                        artist_mbid,
                        artist_name,
                        "monitor_artist",
                        "updated",
                        mapped_artist_names=mapped_artist_names,
                        details="monitored=true; monitorNewItems=none",
                    )
                if not artist_was_added:
                    if selected:
                        summary.lidarr_updated += 1
                    else:
                        summary.lidarr_skipped += 1
                if not any(action["artist_mbid"] == artist_mbid for action in actions):
                    record(
                        artist_mbid,
                        artist_name,
                        "reconcile_artist",
                        "unchanged",
                        mapped_artist_names=mapped_artist_names,
                    )
            except (requests.RequestException, RuntimeError) as exc:
                logger.error("Lidarr operation failed for artist %s: %s", artist_mbid, exc)
                summary.lidarr_skipped += 1
                record(
                    artist_mbid,
                    (artist or {}).get("artistName") or artist_mbid,
                    "reconcile_artist",
                    "failed",
                    details=str(exc),
                )
        return actions
