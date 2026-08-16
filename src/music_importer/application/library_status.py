"""Classify playlist tracks against the downloaded Lidarr library."""

from dataclasses import dataclass

from ..domain.models import MusicBrainzResult


@dataclass(frozen=True, slots=True)
class LibraryTrackStatus:
    position: int
    classification: str
    path: str | None = None


_DOWNLOADED = {
    "represented_locally",
    "release_downloaded",
    "recording_match",
    "alternate_version_title_match",
}
_DOWNLOADABLE = {
    "artist_missing",
    "release_missing",
    "release_unmonitored_missing",
    "release_monitored_missing",
}


def library_availability(classification: str, path: str | None = None) -> str:
    if path or classification in _DOWNLOADED:
        return "downloaded"
    if classification in _DOWNLOADABLE:
        return "downloadable"
    return "not_downloadable"


class LibraryStatusService:
    def __init__(self, lidarr):
        self.lidarr = lidarr

    def refresh(self, results: list[MusicBrainzResult], progress=None) -> list[LibraryTrackStatus]:
        artist_count = len(
            {result.primary_artist_id for result in results if result.primary_artist_id}
        )
        total = 2 + artist_count * 2
        current = 0

        def advance(item: str) -> None:
            nonlocal current
            current += 1
            if progress:
                progress(current, total, item)

        if progress:
            progress(0, total, "Comparing requested recordings with Lidarr")
        missing, matched = self.lidarr.compare(results, advance)
        paths = self.lidarr.downloaded_paths(results, advance)
        statuses = []
        for position, result in enumerate(results):
            classification = (
                "represented_locally"
                if position in paths
                else matched.get(position, missing.get(position, "unresolved"))
            )
            statuses.append(LibraryTrackStatus(position, classification, paths.get(position)))
        return statuses
