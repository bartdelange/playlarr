import os
from collections.abc import Mapping
from dataclasses import dataclass, is_dataclass, replace
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


def _integer(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


def _number(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be a number") from exc


@dataclass(frozen=True, slots=True)
class Config:
    data_dir: Path
    output_dir: Path
    mb_base_url: str
    mb_user_agent: str
    mb_request_delay: float
    mb_timeout: float
    mb_max_retries: int
    tidal_session_file: Path
    spotify_client_id: str | None
    spotify_redirect_uri: str
    spotify_token_cache: Path
    lidarr_url: str | None
    lidarr_api_key: str | None
    lidarr_quality_profile_id: int
    lidarr_metadata_profile_id: int
    lidarr_root_folder: str
    navidrome_url: str | None
    navidrome_username: str | None
    navidrome_password: str | None

    @property
    def lidarr_enabled(self) -> bool:
        return bool(self.lidarr_url and self.lidarr_api_key)

    @property
    def navidrome_enabled(self) -> bool:
        return bool(self.navidrome_url and self.navidrome_username and self.navidrome_password)


_PATH_FIELDS = {"data_dir", "output_dir", "tidal_session_file", "spotify_token_cache"}


def apply_stored_config(config: Config, stored: object) -> Config:
    """Overlay settings saved by the UI without overriding deployment mount paths."""
    if not is_dataclass(config) or not isinstance(stored, Mapping):
        return config

    values: dict[str, Any] = {}
    for key, value in stored.items():
        if not isinstance(key, str) or key not in Config.__dataclass_fields__:
            continue
        values[key] = Path(value) if key in _PATH_FIELDS else value

    # Container and service managers use these variables to establish storage
    # boundaries. A value saved on another host must never shadow them.
    if os.getenv("DATA_DIR"):
        values.pop("data_dir", None)
    if os.getenv("OUTPUT_DIR"):
        values.pop("output_dir", None)

    return replace(config, **values)


def service_config_values(
    config: Config,
    previous: object,
    *,
    mb_user_agent: str,
    spotify_client_id: str,
    spotify_redirect_uri: str,
    lidarr_url: str,
    lidarr_api_key: str,
    lidarr_root_folder: str,
    lidarr_quality_profile_id: int,
    lidarr_metadata_profile_id: int,
    navidrome_url: str,
    navidrome_username: str,
    navidrome_password: str,
    output_dir: str,
) -> dict[str, object]:
    """Normalize settings form values and preserve replacement-only secrets."""
    saved = previous if isinstance(previous, Mapping) else {}
    return {
        "mb_user_agent": mb_user_agent.strip(),
        "spotify_client_id": (
            spotify_client_id.strip() or saved.get("spotify_client_id") or config.spotify_client_id
        ),
        "spotify_redirect_uri": spotify_redirect_uri.strip() or config.spotify_redirect_uri,
        "lidarr_url": lidarr_url.strip().rstrip("/") or None,
        "lidarr_api_key": lidarr_api_key.strip()
        or saved.get("lidarr_api_key")
        or config.lidarr_api_key,
        "lidarr_root_folder": lidarr_root_folder.strip() or config.lidarr_root_folder,
        "lidarr_quality_profile_id": lidarr_quality_profile_id,
        "lidarr_metadata_profile_id": lidarr_metadata_profile_id,
        "navidrome_url": navidrome_url.strip().rstrip("/") or None,
        "navidrome_username": navidrome_username.strip()
        or saved.get("navidrome_username")
        or config.navidrome_username,
        "navidrome_password": navidrome_password.strip()
        or saved.get("navidrome_password")
        or config.navidrome_password,
        "output_dir": Path(output_dir.strip() or str(config.output_dir)),
    }


def serializable_config(values: Mapping[str, object]) -> dict[str, object]:
    return {key: str(value) if isinstance(value, Path) else value for key, value in values.items()}


def load_config() -> Config:
    load_dotenv()
    return Config(
        data_dir=Path(os.getenv("DATA_DIR", ".data")),
        output_dir=Path(os.getenv("OUTPUT_DIR", "output")),
        mb_base_url=os.getenv("MUSICBRAINZ_BASE_URL", "https://musicbrainz.org/ws/2").rstrip("/"),
        mb_user_agent=os.getenv("MUSICBRAINZ_USER_AGENT", "").strip(),
        mb_request_delay=_number("MUSICBRAINZ_REQUEST_DELAY", 1.1),
        mb_timeout=_number("MUSICBRAINZ_REQUEST_TIMEOUT", 30),
        mb_max_retries=_integer("MUSICBRAINZ_MAX_RETRIES", 5),
        tidal_session_file=Path(os.getenv("TIDAL_SESSION_FILE", ".secrets/tidal-session.json")),
        spotify_client_id=os.getenv("SPOTIFY_CLIENT_ID") or None,
        spotify_redirect_uri=os.getenv("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:8787/callback"),
        spotify_token_cache=Path(os.getenv("SPOTIFY_TOKEN_CACHE", ".secrets/spotify-token.json")),
        lidarr_url=(os.getenv("LIDARR_URL") or "").rstrip("/") or None,
        lidarr_api_key=os.getenv("LIDARR_API_KEY") or None,
        lidarr_quality_profile_id=_integer("LIDARR_QUALITY_PROFILE_ID", 1),
        lidarr_metadata_profile_id=_integer("LIDARR_METADATA_PROFILE_ID", 1),
        lidarr_root_folder=os.getenv("LIDARR_ROOT_FOLDER", "/music"),
        navidrome_url=(os.getenv("NAVIDROME_URL") or "").rstrip("/") or None,
        navidrome_username=os.getenv("NAVIDROME_USERNAME") or None,
        navidrome_password=os.getenv("NAVIDROME_PASSWORD") or None,
    )
