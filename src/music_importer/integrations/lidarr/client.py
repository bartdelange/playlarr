"""Composed Lidarr client preserving the established application boundary."""

from .execution import ExecutionClient
from .library import LibraryClient
from .planning import PlanningClient
from .synchronization import SynchronizationClient
from .transport import TransportClient


class LidarrClient(
    PlanningClient, ExecutionClient, LibraryClient, SynchronizationClient, TransportClient
):
    """Lidarr transport, read-only planning, approved execution, and inspection facade."""
