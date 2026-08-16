import logging
from collections.abc import Callable

from ...domain.models import (
    MusicBrainzResult,
)
from .matching import (
    _VARIOUS_ARTISTS_MBID,
    _downloaded_track_keys,
    _title_fallback_matches,
)

logger = logging.getLogger("music_importer.integrations.lidarr.client")


class ComparisonClient:
    def compare(
        self, results: list[MusicBrainzResult], progress: Callable[[str], None] | None = None
    ) -> tuple[dict[int, str], dict[int, str]]:
        """Return missing and matched result indexes with their classification reasons."""
        existing = {
            artist.get("foreignArtistId"): artist for artist in self._request("GET", "artist") or []
        }
        if progress:
            progress("Loaded Lidarr artists for comparison")
        albums_by_artist: dict[int, dict[str, dict]] = {}
        global_albums_by_group: dict[str, dict | None] = {}
        global_tracks_by_album_id: dict[int, list[dict]] = {}
        files_by_artist: dict[int, tuple[set[str], set[str]]] = {}
        missing: dict[int, str] = {}
        matched: dict[int, str] = {}
        processed_artists: set[str] = set()
        for index, result in enumerate(results):
            if not result.primary_artist_id:
                missing[index] = "musicbrainz_unresolved"
                continue
            if not result.release_group_ids:
                missing[index] = "release_group_unresolved"
                continue
            if result.primary_artist_id == _VARIOUS_ARTISTS_MBID or any(
                name.casefold() == "various artists" for name in result.artist_names
            ):
                missing[index] = "various_artists_skipped"
                continue
            artist = existing.get(result.primary_artist_id)
            if not artist:
                missing[index] = "artist_missing"
                if progress and result.primary_artist_id not in processed_artists:
                    processed_artists.add(result.primary_artist_id)
                    progress(
                        f"Compared {result.artist_names[0] if result.artist_names else result.primary_artist_id}"
                    )
                continue
            artist_id = artist["id"]
            if artist_id not in albums_by_artist:
                albums = self._request("GET", "album", params={"artistId": artist_id}) or []
                albums_by_artist[artist_id] = {
                    album["foreignAlbumId"]: album
                    for album in albums
                    if album.get("foreignAlbumId")
                }
            exact_albums = [
                albums_by_artist[artist_id][release_group]
                for release_group in result.release_group_ids
                if release_group in albums_by_artist[artist_id]
            ]
            if artist_id not in files_by_artist:
                tracks = self._request("GET", "track", params={"artistId": artist_id}) or []
                files_by_artist[artist_id] = _downloaded_track_keys(tracks)
            recording_ids, titles = files_by_artist[artist_id]
            same_recording = bool(recording_ids.intersection(result.recording_ids))
            same_title = bool(
                result.recording_title
                and any(_title_fallback_matches(result.recording_title, title) for title in titles)
            )
            if not same_recording and not same_title and not exact_albums:
                for release_group in result.release_group_ids:
                    if release_group not in global_albums_by_group:
                        matches = (
                            self._request("GET", "album", params={"foreignAlbumId": release_group})
                            or []
                        )
                        global_albums_by_group[release_group] = next(
                            (
                                album
                                for album in matches
                                if album.get("foreignAlbumId") == release_group
                            ),
                            None,
                        )
                    album = global_albums_by_group[release_group]
                    if album is not None:
                        exact_albums.append(album)
                        album_id = album.get("id")
                        # Existing files are safe to recognize regardless of album ownership.
                        # Various Artists protections remain enforced by planning and execution.
                        if album_id is not None:
                            if album_id not in global_tracks_by_album_id:
                                global_tracks_by_album_id[album_id] = (
                                    self._request("GET", "track", params={"albumId": album_id})
                                    or []
                                )
                            global_recording_ids, global_titles = _downloaded_track_keys(
                                global_tracks_by_album_id[album_id]
                            )
                            same_recording = bool(
                                global_recording_ids.intersection(result.recording_ids)
                            )
                            same_title = bool(
                                result.recording_title
                                and any(
                                    _title_fallback_matches(result.recording_title, title)
                                    for title in global_titles
                                )
                            )
                            if same_recording or same_title:
                                break
            if same_recording:
                matched[index] = "release_downloaded" if exact_albums else "recording_match"
            elif same_title:
                matched[index] = "alternate_version_title_match"
            elif exact_albums:
                missing[index] = (
                    "release_monitored_missing"
                    if any(album.get("monitored") for album in exact_albums)
                    else "release_unmonitored_missing"
                )
            else:
                missing[index] = "release_missing"
            if progress and result.primary_artist_id not in processed_artists:
                processed_artists.add(result.primary_artist_id)
                progress(
                    f"Compared {result.artist_names[0] if result.artist_names else result.primary_artist_id}"
                )
        return missing, matched
