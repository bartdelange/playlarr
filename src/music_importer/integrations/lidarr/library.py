"""Composed Lidarr library inspection."""

from .comparison import ComparisonClient
from .downloaded_library import DownloadedLibraryClient


class LibraryClient(ComparisonClient, DownloadedLibraryClient):
    pass
