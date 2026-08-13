import hashlib
import re
import secrets
import unicodedata
from pathlib import Path

import requests

from .config import Config


def _comparable(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).casefold()
    value = "".join(character for character in value if not unicodedata.combining(character))
    return " ".join(re.findall(r"[a-z0-9]+", value))


def _artist_matches(wanted: str, candidate: str) -> bool:
    wanted_value = _comparable(wanted)
    candidate_parts = [_comparable(part) for part in re.split(r"[;,•/]", candidate)]
    return bool(wanted_value and any(part == wanted_value for part in candidate_parts))


class NavidromeClient:
    def __init__(self, config: Config):
        self.url = config.navidrome_url or ""
        self.username = config.navidrome_username or ""
        self.password = config.navidrome_password or ""
        self.root_folder = config.navidrome_root_folder
        self.session = requests.Session()

    def _request(self, endpoint: str, **params: object) -> dict:
        salt = secrets.token_hex(8)
        token = hashlib.md5(f"{self.password}{salt}".encode()).hexdigest()
        response = self.session.get(
            f"{self.url}/rest/{endpoint}",
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
            raise RuntimeError(f"Navidrome API error: {error.get('message', 'unknown error')}")
        return payload

    def find_song(self, artist: str, title: str, album: str = "") -> tuple[str | None, str]:
        """Return a unique exact metadata match and a diagnostic classification."""
        primary_artist = artist.split(";", 1)[0].strip()
        query = " - ".join(value for value in (primary_artist, title) if value)
        payload = self._request(
            "search3.view", query=query, artistCount=0, albumCount=0, songCount=50
        )
        songs = payload.get("searchResult3", {}).get("song", [])
        wanted_title = _comparable(title)
        wanted_artists = [part.strip() for part in artist.split(";") if part.strip()]
        matches = [
            song
            for song in songs
            if _comparable(str(song.get("title", ""))) == wanted_title
            and any(
                _artist_matches(wanted, str(song.get("artist", ""))) for wanted in wanted_artists
            )
        ]
        if album:
            album_matches = [
                song
                for song in matches
                if _comparable(str(song.get("album", ""))) == _comparable(album)
            ]
            if album_matches:
                matches = album_matches
        paths = {str(song.get("path", "")) for song in matches if song.get("path")}
        if len(paths) != 1:
            return None, "navidrome_no_match" if not paths else "navidrome_ambiguous"
        path = paths.pop()
        if self.root_folder and not Path(path).is_absolute():
            path = str(Path(self.root_folder) / path)
        return path, "navidrome_exact_match"
