import logging
import time

import requests

from ...config import Config
from .matching import (
    _is_various_artists_album,
)

logger = logging.getLogger("music_importer.integrations.lidarr.client")


class TransportClient:
    def __init__(self, config: Config):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({"X-Api-Key": config.lidarr_api_key or ""})

    def _request(self, method: str, path: str, **kwargs):
        attempts = 3 if method.upper() == "GET" else 1
        response = None
        for attempt in range(1, attempts + 1):
            try:
                response = self.session.request(
                    method, f"{self.config.lidarr_url}/api/v1/{path}", timeout=30, **kwargs
                )
                break
            except requests.Timeout as exc:
                if attempt == attempts:
                    raise requests.Timeout(
                        f"Lidarr {method.upper()} /api/v1/{path} timed out after "
                        f"{attempts} attempt{'s' if attempts != 1 else ''}"
                    ) from exc
                logger.warning(
                    "Lidarr %s %s timed out; retrying (%s/%s)", method, path, attempt, attempts
                )
                time.sleep(0.5 * attempt)
        assert response is not None
        try:
            response.raise_for_status()
        except requests.HTTPError:
            logger.error(
                "Lidarr %s %s failed with HTTP %s: %s",
                method,
                path,
                response.status_code,
                response.text,
            )
            raise
        return response.json() if response.content else None

    def _lookup(self, path: str, foreign_id: str, id_field: str) -> dict:
        matches = self._request("GET", path, params={"term": f"lidarr:{foreign_id}"}) or []
        return next((match for match in matches if match.get(id_field) == foreign_id), {})

    def root_folders(self) -> list[tuple[str, str]]:
        folders = self._request("GET", "rootfolder") or []
        return sorted(
            ((folder["path"], folder["path"]) for folder in folders if folder.get("path")),
            key=lambda folder: folder[1].casefold(),
        )

    def quality_profiles(self) -> list[tuple[int, str]]:
        profiles = self._request("GET", "qualityprofile") or []
        return sorted(
            (
                (profile["id"], profile["name"])
                for profile in profiles
                if profile.get("id") is not None and profile.get("name")
            ),
            key=lambda profile: profile[1].casefold(),
        )

    def metadata_profiles(self) -> list[tuple[int, str]]:
        profiles = self._request("GET", "metadataprofile") or []
        return sorted(
            (
                (profile["id"], profile["name"])
                for profile in profiles
                if profile.get("id") is not None and profile.get("name")
            ),
            key=lambda profile: profile[1].casefold(),
        )

    def _artist_payload(self, artist_mbid: str, release_groups: set[str]) -> dict:
        payload = self._lookup("artist/lookup", artist_mbid, "foreignArtistId")
        if not payload:
            raise RuntimeError(f"Lidarr could not look up artist {artist_mbid}")
        payload.update(
            {
                "qualityProfileId": self.config.lidarr_quality_profile_id,
                "metadataProfileId": self.config.lidarr_metadata_profile_id,
                "rootFolderPath": self.config.lidarr_root_folder,
                "monitored": False,
                "monitorNewItems": "none",
                "addOptions": {
                    "monitor": "none",
                    "monitored": False,
                    "albumsToMonitor": [],
                    "searchForMissingAlbums": False,
                },
            }
        )
        return payload

    def _add_album(
        self,
        artist: dict,
        release_group: str,
        allow_various_artists: bool = False,
        requested_release_ids: set[str] | None = None,
    ) -> dict | None:
        payload = self._lookup("album/lookup", release_group, "foreignAlbumId")
        if not payload:
            raise RuntimeError(f"Lidarr could not look up release group {release_group}")
        if _is_various_artists_album(payload) and not allow_various_artists:
            return None
        # Use the local artist resource so Lidarr attaches the album to the existing artist.
        payload.update(
            {
                "artistId": artist["id"],
                "artist": artist,
                "monitored": False,
                "addOptions": {"addType": "manual", "searchForNewAlbum": False},
            }
        )
        self._pin_selected_release(payload, requested_release_ids or set())
        return self._request("POST", "album", json=payload) or {}

    @staticmethod
    def _pin_selected_release(album: dict, requested_release_ids: set[str]) -> bool:
        candidates = [
            release
            for release in album.get("releases") or []
            if release.get("foreignReleaseId") in requested_release_ids
        ]
        if not candidates:
            return False
        selected = next(
            (release for release in candidates if release.get("monitored")), candidates[0]
        )
        changed = album.get("anyReleaseOk") is not False
        album["anyReleaseOk"] = False
        for release in album.get("releases") or []:
            monitored = release is selected
            changed = changed or release.get("monitored") is not monitored
            release["monitored"] = monitored
        return changed

    def _monitor_artist(self, artist: dict) -> bool:
        if artist.get("monitored") is True and artist.get("monitorNewItems") == "none":
            return False
        artist.update({"monitored": True, "monitorNewItems": "none"})
        self._request("PUT", f"artist/{artist['id']}", json=artist)
        return True
