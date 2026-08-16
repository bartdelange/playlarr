import logging
import re
from concurrent.futures import Future
from pathlib import Path

import requests
import tidalapi

from ...domain.models import AcquiredTrack, PlaylistInfo, SourceTrack

logger = logging.getLogger(__name__)
_PLAYLIST_RE = re.compile(r"(?:playlist/|playlist:)([0-9a-f-]+)", re.IGNORECASE)


class TidalAuthenticationRequired(RuntimeError):
    pass


class _TimeoutSession(requests.Session):
    def request(self, *args, **kwargs):
        kwargs.setdefault("timeout", 30)
        return super().request(*args, **kwargs)


class TidalSource:
    name = "tidal"

    def __init__(self, session_file: Path):
        self.session_file = session_file
        self.session = tidalapi.Session()
        self.session.request_session = _TimeoutSession()
        self._playlists: dict[str, object] = {}
        self._auth: tuple[str, Future] | None = None
        self._auth_error: str | None = None

    def login(self) -> None:
        self.session_file.parent.mkdir(parents=True, exist_ok=True)
        self.session.load_session_from_file(self.session_file)
        if not self.session.check_login():
            raise TidalAuthenticationRequired("authenticate TIDAL in Settings first")
        logger.info("Authenticated with TIDAL")

    def authorization_url(self) -> str:
        login, future = self.session.login_oauth()
        url = f"https://{login.verification_uri_complete}"
        self._auth = (url, future)
        self._auth_error = None

        def save(completed: Future) -> None:
            try:
                if completed.result():
                    self.session_file.parent.mkdir(parents=True, exist_ok=True)
                    self.session.save_session_to_file(self.session_file)
            except Exception as exc:
                self._auth_error = str(exc)

        future.add_done_callback(save)
        return url

    def authorization_status(self) -> tuple[str, str | None]:
        if self._auth_error:
            return "failed", self._auth_error
        if self._auth is None:
            return "missing", None
        return ("completed", None) if self._auth[1].done() else ("pending", None)

    def _walk(self, favorites, folder=None, path=""):
        if folder is None:
            for playlist in favorites.playlists():
                yield path, playlist
            for child in favorites.playlist_folders():
                yield from self._walk(favorites, child, f"{path}{child.name}/")
            return
        try:
            for item in folder.items():
                if isinstance(item, tidalapi.Playlist):
                    yield path, item
                elif hasattr(item, "items"):
                    yield from self._walk(favorites, item, f"{path}{item.name}/")
        except (AttributeError, TypeError, RuntimeError) as exc:
            logger.warning("Could not read TIDAL folder %s: %s", path or "root", exc)

    def list_playlists(self) -> list[PlaylistInfo]:
        favorites = tidalapi.Favorites(self.session, self.session.user.id)
        result = []
        for path, item in self._walk(favorites):
            self._playlists[str(item.id)] = item
            result.append(
                PlaylistInfo(
                    self.name,
                    str(item.id),
                    item.name,
                    path.rstrip("/") or None,
                    getattr(item, "num_tracks", None),
                )
            )
        return result

    @staticmethod
    def _id(value: str) -> str:
        match = _PLAYLIST_RE.search(value)
        return match.group(1) if match else value.strip().split("?", 1)[0].rstrip("/")

    def get_playlist(self, playlist_id_or_url: str) -> PlaylistInfo:
        playlist_id = self._id(playlist_id_or_url)
        item = self._playlists.get(playlist_id) or tidalapi.playlist.Playlist(
            self.session, playlist_id
        )
        return PlaylistInfo(
            self.name, playlist_id, item.name, None, getattr(item, "num_tracks", None)
        )

    def get_tracks(self, playlist: PlaylistInfo) -> list[SourceTrack]:
        item = self._playlists.get(playlist.id) or tidalapi.playlist.Playlist(
            self.session, playlist.id
        )
        result = []
        for track in item.tracks():
            result.append(
                SourceTrack(
                    source=self.name,
                    source_track_id=str(track.id),
                    title=track.name,
                    artists=tuple(a.name for a in (track.artists or [])),
                    album=track.album.name if track.album else "",
                    isrc=getattr(track, "isrc", None),
                    duration_ms=(
                        int(float(track.duration) * 1000)
                        if getattr(track, "duration", None) is not None
                        else None
                    ),
                )
            )
        return result

    def get_entries(self, playlist: PlaylistInfo) -> list[AcquiredTrack]:
        return [
            AcquiredTrack(position, track)
            for position, track in enumerate(self.get_tracks(playlist))
        ]
