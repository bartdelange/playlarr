"""Composed Lidarr synchronization compatibility."""

from .legacy_sync import LegacySyncClient
from .planned_sync import PlannedSyncClient


class SynchronizationClient(PlannedSyncClient, LegacySyncClient):
    pass
