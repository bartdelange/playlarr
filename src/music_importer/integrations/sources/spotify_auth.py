"""Spotify PKCE authorization without a local callback listener."""

import secrets
from pathlib import Path

import spotipy
from spotipy.cache_handler import CacheFileHandler
from spotipy.oauth2 import SpotifyPKCE

REQUEST_TIMEOUT_SECONDS = 30
SCOPE = "playlist-read-private playlist-read-collaborative"


class SpotifyAuthenticationRequired(RuntimeError):
    pass


class SpotifyAuthenticator:
    def __init__(self, client_id: str, redirect_uri: str, token_cache: Path):
        self.client_id = client_id
        self.redirect_uri = redirect_uri
        self.token_cache = token_cache
        self.pending: tuple[str, SpotifyPKCE] | None = None

    def _manager(self, *, state: str | None = None) -> SpotifyPKCE:
        self.token_cache.parent.mkdir(parents=True, exist_ok=True)
        return SpotifyPKCE(
            client_id=self.client_id,
            redirect_uri=self.redirect_uri,
            state=state,
            scope=SCOPE,
            cache_handler=CacheFileHandler(cache_path=str(self.token_cache)),
            open_browser=False,
            requests_timeout=REQUEST_TIMEOUT_SECONDS,
        )

    @staticmethod
    def _connect(auth: SpotifyPKCE) -> tuple[spotipy.Spotify, str | None]:
        if auth.cache_handler.get_cached_token() is None:
            raise SpotifyAuthenticationRequired("authenticate Spotify in Settings first")
        access_token = auth.get_access_token(check_cache=True)
        client = spotipy.Spotify(auth=access_token, requests_timeout=REQUEST_TIMEOUT_SECONDS)
        return client, client.current_user().get("id")

    def login(self) -> tuple[spotipy.Spotify, str | None]:
        return self._connect(self._manager())

    def authorization_url(self) -> str:
        state = secrets.token_urlsafe(32)
        auth = self._manager(state=state)
        self.pending = (state, auth)
        return auth.get_authorize_url()

    def complete(self, code: str, state: str) -> tuple[spotipy.Spotify, str | None]:
        pending = self.pending
        self.pending = None
        if pending is None or not secrets.compare_digest(state, pending[0]):
            raise ValueError("Spotify authentication state is missing or invalid; try again")
        pending[1].get_access_token(code=code, check_cache=False)
        return self._connect(pending[1])
