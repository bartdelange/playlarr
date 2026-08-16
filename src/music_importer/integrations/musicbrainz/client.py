"""Composed MusicBrainz resolution and manual-review client."""

from .manual_matching import ManualMatchingClient
from .resolution import ResolutionClient
from .transport import TransportClient


class MusicBrainzClient(ManualMatchingClient, ResolutionClient, TransportClient):
    pass
