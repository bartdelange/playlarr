"""Read-only Navidrome access through the Subsonic-compatible API."""

import hashlib
import secrets
from dataclasses import dataclass

import requests

from ...config import Config


@dataclass(frozen=True, slots=True)
class NavidromeSong:
    id: str
    title: str
    artist: str
    album: str
    path: str


class NavidromeClient:
    def __init__(self, config: Config):
        if not config.navidrome_enabled:
            raise ValueError("Navidrome is not configured")
        self.base_url = config.navidrome_url
        self.username = config.navidrome_username
        self.password = config.navidrome_password

    def _request(self, method: str, **params) -> dict:
        salt = secrets.token_hex(8)
        token = hashlib.md5(f"{self.password}{salt}".encode(), usedforsecurity=False).hexdigest()
        response = requests.get(
            f"{self.base_url}/rest/{method}.view",
            params={
                "u": self.username,
                "t": token,
                "s": salt,
                "v": "1.16.1",
                "c": "music-importer",
                "f": "json",
                **params,
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json().get("subsonic-response", {})
        if payload.get("status") != "ok":
            error = payload.get("error", {})
            raise RuntimeError(error.get("message") or "Navidrome request failed")
        return payload

    @staticmethod
    def _song(payload: dict) -> NavidromeSong:
        return NavidromeSong(
            str(payload["id"]),
            payload.get("title", ""),
            payload.get("artist", ""),
            payload.get("album", ""),
            payload.get("path", ""),
        )

    def search_songs(self, query: str, limit: int = 50) -> list[NavidromeSong]:
        payload = self._request(
            "search3", query=query, songCount=limit, albumCount=0, artistCount=0
        )
        songs = payload.get("searchResult3", {}).get("song", [])
        return [self._song(song) for song in songs]

    def song(self, song_id: str) -> NavidromeSong:
        return self._song(self._request("getSong", id=song_id)["song"])

    def paths(self, song_ids: list[str]) -> dict[int, str]:
        paths = {}
        for index, song_id in enumerate(song_ids):
            try:
                path = self.song(song_id).path
            except (KeyError, RuntimeError, requests.RequestException):
                continue
            if path:
                paths[index] = path
        return paths
