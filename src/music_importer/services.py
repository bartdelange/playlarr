"""Reusable application services shared by the CLI and the local web UI.

These services deliberately contain no terminal, HTTP-route, or CSV concerns.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from .models import MusicBrainzResult, PlaylistInfo, SourceTrack, Summary
from .sources.base import MusicSource


class TrackResolver(Protocol):
    def resolve(self, track: SourceTrack) -> MusicBrainzResult: ...


@dataclass(frozen=True, slots=True)
class ResolutionProgress:
    current: int
    total: int
    track: SourceTrack


@dataclass(slots=True)
class ResolutionBatch:
    tracks: list[SourceTrack]
    results: list[MusicBrainzResult]
    summary: Summary


class PlaylistService:
    """Source-neutral authentication and playlist acquisition operations."""

    def __init__(self, source: MusicSource):
        self.source = source

    def authenticate(self) -> None:
        self.source.login()

    def list_playlists(self) -> list[PlaylistInfo]:
        return self.source.list_playlists()

    def get_playlist(self, playlist_id_or_url: str) -> PlaylistInfo:
        return self.source.get_playlist(playlist_id_or_url)

    def get_tracks(self, playlist: PlaylistInfo) -> list[SourceTrack]:
        return self.source.get_tracks(playlist)


class ResolutionService:
    """Resolve tracks while reporting structured, presentation-neutral progress."""

    def __init__(self, resolver: TrackResolver):
        self.resolver = resolver

    def resolve_tracks(
        self,
        tracks: list[SourceTrack],
        progress: Callable[[ResolutionProgress], None] | None = None,
    ) -> ResolutionBatch:
        summary = Summary(total=len(tracks))
        results: list[MusicBrainzResult] = []
        for number, track in enumerate(tracks, 1):
            if progress:
                progress(ResolutionProgress(number, len(tracks), track))
            result = self.resolver.resolve(track)
            results.append(result)
            if result.resolved_via == "isrc":
                summary.resolved_by_isrc += 1
            elif result.resolved_via == "search":
                summary.resolved_by_search += 1
            else:
                summary.unresolved += 1
        return ResolutionBatch(tracks, results, summary)


@dataclass(frozen=True, slots=True)
class PlaylistFileEntry:
    position: int
    artist: str
    title: str
    path: str


@dataclass(frozen=True, slots=True)
class MissingPlaylistEntry:
    position: int
    track: SourceTrack
    reason: str


@dataclass(frozen=True, slots=True)
class PlaylistExportResult:
    entries: tuple[PlaylistFileEntry, ...]
    missing: tuple[MissingPlaylistEntry, ...]


class DownloadedPathProvider(Protocol):
    def downloaded_paths(self, results: list[MusicBrainzResult]) -> dict[int, str]: ...


class PlaylistExportService:
    """Resolve downloaded paths without writing a file or depending on CSV state."""

    def __init__(self, library: DownloadedPathProvider):
        self.library = library

    @staticmethod
    def _translate(path: str, mappings: list[tuple[str, str]]) -> str:
        for source, target in mappings:
            if path == source or path.startswith(source + "/") or path.startswith(source + "\\"):
                return target + path[len(source) :]
        return path

    def build(
        self,
        tracks: list[SourceTrack],
        results: list[MusicBrainzResult],
        path_mappings: list[tuple[str, str]],
    ) -> PlaylistExportResult:
        if len(tracks) != len(results):
            raise ValueError("playlist tracks and MusicBrainz results must have equal length")
        paths = self.library.downloaded_paths(results)
        entries: list[PlaylistFileEntry] = []
        missing: list[MissingPlaylistEntry] = []
        for index, (track, result) in enumerate(zip(tracks, results)):
            if index in paths:
                entries.append(
                    PlaylistFileEntry(
                        index,
                        "; ".join(track.artists),
                        track.title,
                        self._translate(paths[index], path_mappings),
                    )
                )
            else:
                reason = (
                    "musicbrainz_unresolved"
                    if not result.resolved_via
                    else "not_downloaded_or_unmatched"
                )
                missing.append(MissingPlaylistEntry(index, track, reason))
        return PlaylistExportResult(tuple(entries), tuple(missing))


class PersistentImportService:
    """Coordinates durable imports without any CLI or web presentation logic."""

    def __init__(self, repository):
        self.repository = repository

    def acquire(self, source: MusicSource, playlist: PlaylistInfo):
        imported = self.repository.create_import(
            playlist, metadata={"owner": playlist.owner, "track_count": playlist.track_count}
        )
        self.acquire_into(imported.id, source, playlist)
        return self.repository.get_import(imported.id)

    def acquire_into(self, import_id: str, source: MusicSource, playlist: PlaylistInfo) -> None:
        self.repository.update_import_playlist(
            import_id,
            playlist,
            metadata={"owner": playlist.owner, "track_count": playlist.track_count},
        )
        try:
            if hasattr(source, "get_entries"):
                self.repository.replace_acquired_tracks(import_id, source.get_entries(playlist))
            else:
                self.repository.replace_tracks(import_id, source.get_tracks(playlist))
        except Exception as exc:
            self.repository.set_workflow_state(import_id, "acquisition_failed", str(exc))
            raise

    def resolve(
        self,
        import_id: str,
        resolver: TrackResolver,
        progress: Callable[[ResolutionProgress], None] | None = None,
        cancelled: Callable[[], bool] | None = None,
    ) -> Summary:
        entries = self.repository.entries(import_id)
        summary = Summary(total=len(entries))
        self.repository.set_workflow_state(import_id, "resolving")
        for number, entry in enumerate(entries, 1):
            if cancelled and cancelled():
                self.repository.set_workflow_state(import_id, "resolution_interrupted")
                return summary
            if entry.resolution_state == "skipped":
                continue
            if entry.is_manual:
                if entry.resolution_state == "manually_resolved":
                    summary.resolved_by_search += 1
                continue
            if progress:
                progress(ResolutionProgress(number, len(entries), entry.track))
            self.repository.mark_resolving(entry.id)
            result = resolver.resolve(entry.track)
            self.repository.save_automatic_resolution(entry.id, result)
            if result.resolved_via == "isrc":
                summary.resolved_by_isrc += 1
            elif result.resolved_via:
                summary.resolved_by_search += 1
            else:
                summary.unresolved += 1
        self.repository.set_workflow_state(
            import_id, "review_required" if summary.unresolved else "ready_to_plan"
        )
        return summary


@dataclass(frozen=True, slots=True)
class LibraryTrackStatus:
    position: int
    classification: str
    path: str | None = None


_DOWNLOADED_CLASSIFICATIONS = {
    "represented_locally",
    "release_downloaded",
    "recording_match",
    "alternate_version_title_match",
}
_DOWNLOADABLE_CLASSIFICATIONS = {
    "artist_missing",
    "release_missing",
    "release_unmonitored_missing",
    "release_monitored_missing",
}


def library_availability(classification: str, path: str | None = None) -> str:
    """Collapse diagnostic Lidarr states into the three user-facing outcomes."""
    if path or classification in _DOWNLOADED_CLASSIFICATIONS:
        return "downloaded"
    if classification in _DOWNLOADABLE_CLASSIFICATIONS:
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
            if position in paths:
                classification = "represented_locally"
            elif position in matched:
                classification = matched[position]
            else:
                classification = missing.get(position, "unresolved")
            statuses.append(LibraryTrackStatus(position, classification, paths.get(position)))
        return statuses
