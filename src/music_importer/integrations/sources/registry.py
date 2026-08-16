from ...config import Config
from .base import MusicSource
from .spotify import SpotifySource
from .tidal import TidalSource


def create_source(name: str, config: Config) -> MusicSource:
    """Construct a configured source without coupling callers to SDK adapters."""
    if name == "tidal":
        return TidalSource(config.tidal_session_file)
    if name == "spotify":
        return SpotifySource(
            config.spotify_client_id, config.spotify_redirect_uri, config.spotify_token_cache
        )
    raise ValueError(f"unsupported music source: {name}")
