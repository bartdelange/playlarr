"""Composed SQLite repository for the application's durable capabilities."""

from .database import DatabaseRepository
from .imports import ImportsRepository
from .jobs import JobsRepository
from .library import LibraryRepository
from .lidarr_plans import LidarrPlansRepository
from .local_playlist_additions import LocalPlaylistAdditionsRepository
from .playlist_revisions import PlaylistRevisionsRepository
from .resolutions import ResolutionsRepository
from .settings import SettingsRepository


class ImportRepository(
    ImportsRepository,
    PlaylistRevisionsRepository,
    ResolutionsRepository,
    LidarrPlansRepository,
    LocalPlaylistAdditionsRepository,
    LibraryRepository,
    SettingsRepository,
    JobsRepository,
    DatabaseRepository,
):
    """Unified repository facade composed from capability-specific persistence modules."""
