import logging
import re
from pathlib import Path

import spotipy
from spotipy.cache_handler import CacheFileHandler
from spotipy.oauth2 import SpotifyPKCE

from ...domain.models import AcquiredTrack, PlaylistInfo, SourceTrack

logger = logging.getLogger(__name__)
_PLAYLIST_RE = re.compile(r"(?:open\.spotify\.com/playlist/|spotify:playlist:)([A-Za-z0-9]+)")


class SpotifySource:
    name = "spotify"

    def __init__(self, client_id: str | None, redirect_uri: str, token_cache: Path):
        if not client_id:
            raise ValueError("SPOTIFY_CLIENT_ID is required for Spotify")
        self.client_id = client_id
        self.redirect_uri = redirect_uri
        self.token_cache = token_cache
        self.client: spotipy.Spotify | None = None
        self.user_id: str | None = None

    def login(self) -> None:
        self.token_cache.parent.mkdir(parents=True, exist_ok=True)
        auth = SpotifyPKCE(
            client_id=self.client_id,
            redirect_uri=self.redirect_uri,
            scope="playlist-read-private playlist-read-collaborative",
            cache_handler=CacheFileHandler(cache_path=str(self.token_cache)),
            open_browser=True,
        )
        self.client = spotipy.Spotify(auth_manager=auth)
        self.user_id = self.client.current_user().get("id")
        logger.info("Authenticated with Spotify")

    def _api(self) -> spotipy.Spotify:
        if self.client is None:
            raise RuntimeError("Spotify login has not completed")
        return self.client

    @staticmethod
    def _id(value: str) -> str:
        match = _PLAYLIST_RE.search(value)
        return match.group(1) if match else value.strip().split("?", 1)[0].rstrip("/")

    def list_playlists(self) -> list[PlaylistInfo]:
        page = self._api().current_user_playlists(limit=50)
        playlists: list[PlaylistInfo] = []
        while page:
            for item in page.get("items") or []:
                if not item:
                    continue
                playlists.append(
                    PlaylistInfo(
                        source=self.name,
                        id=item["id"],
                        name=item.get("name") or "Untitled",
                        track_count=(item.get("items") or item.get("tracks") or {}).get("total"),
                        is_followed=(
                            bool(self.user_id)
                            and (item.get("owner") or {}).get("id") != self.user_id
                            and not item.get("collaborative", False)
                        ),
                        owner=(item.get("owner") or {}).get("display_name")
                        or (item.get("owner") or {}).get("id"),
                    )
                )
            page = self._api().next(page) if page.get("next") else None
        return playlists

    def get_playlist(self, playlist_id_or_url: str) -> PlaylistInfo:
        item = self._api().playlist(self._id(playlist_id_or_url), fields="id,name,items.total")
        return PlaylistInfo(
            self.name,
            item["id"],
            item.get("name") or "Untitled",
            None,
            (item.get("items") or item.get("tracks") or {}).get("total"),
        )

    def get_entries(self, playlist: PlaylistInfo) -> list[AcquiredTrack]:
        page = self._api().playlist_items(
            playlist.id,
            limit=50,
            fields="items(is_local,item(id,uri,type,name,duration_ms,artists(name),album(name),external_ids)),next",
        )
        entries: list[AcquiredTrack] = []
        position = 0
        while page:
            for entry in page.get("items") or []:
                position += 1
                # Spotify renamed PlaylistTrackObject.track to item in February 2026.
                # Keep the fallback so cached/older API responses continue to work.
                track = (entry.get("item") or entry.get("track")) if entry else None
                reason = None
                if not track:
                    reason = "unavailable track"
                elif track.get("type") != "track":
                    reason = track.get("type") or "non-music item"
                elif not entry.get("is_local") and not track.get("id"):
                    reason = "unavailable track"
                elif not track.get("name") or not any(
                    a.get("name") for a in track.get("artists") or []
                ):
                    reason = "track has insufficient metadata"
                if reason:
                    logger.warning("Skipping Spotify playlist item %d: %s", position, reason)
                    raw = track or {}
                    entries.append(
                        AcquiredTrack(
                            position - 1,
                            SourceTrack(
                                source=self.name,
                                source_track_id=(
                                    raw.get("id")
                                    or raw.get("uri")
                                    or f"skipped:{playlist.id}:{position}"
                                ),
                                title=raw.get("name") or "Unavailable track",
                                artists=tuple(
                                    a["name"] for a in raw.get("artists") or [] if a.get("name")
                                ),
                                album=(raw.get("album") or {}).get("name") or "",
                                duration_ms=raw.get("duration_ms"),
                            ),
                            reason,
                        )
                    )
                    continue
                is_local = bool(entry.get("is_local"))
                if is_local:
                    logger.info(
                        "Including Spotify local track at playlist item %d for metadata search",
                        position,
                    )
                entries.append(
                    AcquiredTrack(
                        position - 1,
                        SourceTrack(
                            source=self.name,
                            source_track_id=(
                                track.get("id")
                                or track.get("uri")
                                or f"local:{playlist.id}:{position}"
                            ),
                            title=track.get("name") or "",
                            artists=tuple(
                                a["name"] for a in track.get("artists") or [] if a.get("name")
                            ),
                            album=(track.get("album") or {}).get("name") or "",
                            isrc=None
                            if is_local
                            else (track.get("external_ids") or {}).get("isrc"),
                            duration_ms=track.get("duration_ms"),
                        ),
                    )
                )
            page = self._api().next(page) if page.get("next") else None
        return entries

    def get_tracks(self, playlist: PlaylistInfo) -> list[SourceTrack]:
        return [entry.track for entry in self.get_entries(playlist) if not entry.skip_reason]
