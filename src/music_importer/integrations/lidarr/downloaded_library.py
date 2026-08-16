import logging
from collections import defaultdict
from collections.abc import Callable
from pathlib import Path

from ...domain.models import (
    MusicBrainzResult,
)
from .matching import (
    _title_fallback_matches,
)

logger = logging.getLogger("music_importer.integrations.lidarr.client")


class DownloadedLibraryClient:
    def downloaded_paths(
        self, results: list[MusicBrainzResult], progress: Callable[[str], None] | None = None
    ) -> dict[int, str]:
        """Return playlist result indexes mapped to downloaded Lidarr file paths."""
        existing = {
            artist.get("foreignArtistId"): artist for artist in self._request("GET", "artist") or []
        }
        if progress:
            progress("Loaded Lidarr artists for file lookup")
        indexes_by_artist: dict[str, list[int]] = defaultdict(list)
        for index, result in enumerate(results):
            if result.primary_artist_id:
                indexes_by_artist[result.primary_artist_id].append(index)

        matched: dict[int, str] = {}
        for artist_mbid, indexes in indexes_by_artist.items():
            artist = existing.get(artist_mbid)
            if not artist:
                if progress:
                    name = results[indexes[0]].artist_names
                    progress(f"Checked files for {name[0] if name else artist_mbid}")
                continue
            artist_id = artist["id"]
            tracks = self._request("GET", "track", params={"artistId": artist_id}) or []
            files = self._request("GET", "trackFile", params={"artistId": artist_id}) or []
            files_by_id = {item.get("id"): item for item in files if item.get("id") is not None}

            candidates = []
            for track in tracks:
                if not track.get("hasFile"):
                    continue
                track_file = (
                    track.get("trackFile") or files_by_id.get(track.get("trackFileId")) or {}
                )
                path = track_file.get("path")
                if not path and track_file.get("relativePath") and artist.get("path"):
                    path = str(Path(artist["path"]) / track_file["relativePath"])
                if path:
                    candidates.append((track, path))

            for index in indexes:
                result = results[index]
                exact = next(
                    (
                        path
                        for track, path in candidates
                        if {
                            track.get("foreignRecordingId"),
                            track.get("foreignTrackId"),
                        }.intersection(result.recording_ids)
                    ),
                    None,
                )
                if exact:
                    matched[index] = exact
                    continue
                title_match = next(
                    (
                        path
                        for track, path in candidates
                        if _title_fallback_matches(result.recording_title, track.get("title") or "")
                    ),
                    None,
                )
                if title_match:
                    matched[index] = title_match
            if progress:
                name = results[indexes[0]].artist_names
                progress(f"Checked files for {name[0] if name else artist_mbid}")

        albums_by_group: dict[str, dict | None] = {}
        tracks_by_album_id: dict[int, list[dict]] = {}
        files_by_artist_id: dict[int, dict[int, dict]] = {}
        for index, result in enumerate(results):
            if index in matched:
                continue
            for group in result.release_group_ids:
                if group not in albums_by_group:
                    albums = self._request("GET", "album", params={"foreignAlbumId": group}) or []
                    albums_by_group[group] = next(
                        (album for album in albums if album.get("foreignAlbumId") == group), None
                    )
                album = albums_by_group[group]
                if album is None:
                    continue
                # This lookup is read-only. A Various Artists-owned file may satisfy an entry
                # without authorizing the planner to mutate that album or artist.
                album_id = album.get("id")
                artist_id = album.get("artistId") or (album.get("artist") or {}).get("id")
                if album_id is None or artist_id is None:
                    continue
                if album_id not in tracks_by_album_id:
                    tracks_by_album_id[album_id] = (
                        self._request("GET", "track", params={"albumId": album_id}) or []
                    )
                if artist_id not in files_by_artist_id:
                    files = self._request("GET", "trackFile", params={"artistId": artist_id}) or []
                    files_by_artist_id[artist_id] = {
                        item["id"]: item for item in files if item.get("id") is not None
                    }
                candidates = []
                artist_path = (album.get("artist") or {}).get("path")
                for track in tracks_by_album_id[album_id]:
                    if not track.get("hasFile"):
                        continue
                    track_file = files_by_artist_id[artist_id].get(track.get("trackFileId")) or {}
                    path = track_file.get("path")
                    if not path and track_file.get("relativePath") and artist_path:
                        path = str(Path(artist_path) / track_file["relativePath"])
                    if path:
                        candidates.append((track, path))
                exact = next(
                    (
                        path
                        for track, path in candidates
                        if {
                            track.get("foreignRecordingId"),
                            track.get("foreignTrackId"),
                        }.intersection(result.recording_ids)
                    ),
                    None,
                )
                if exact:
                    matched[index] = exact
                    break
                title_match = next(
                    (
                        path
                        for track, path in candidates
                        if _title_fallback_matches(result.recording_title, track.get("title") or "")
                    ),
                    None,
                )
                if title_match:
                    matched[index] = title_match
                    break
        return matched
