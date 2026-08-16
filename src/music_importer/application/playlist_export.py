"""Build ordered playlist exports from downloaded library paths."""

from dataclasses import dataclass
from typing import Protocol

from ..domain.models import LocalPlaylistAddition, MusicBrainzResult, SourceTrack


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


class LocalPathProvider(Protocol):
    def paths(self, song_ids: list[str]) -> dict[int, str]: ...


class PlaylistExportService:
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
        entries = []
        missing = []
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

    def append_local_additions(
        self,
        export: PlaylistExportResult,
        additions: list[LocalPlaylistAddition],
        provider: LocalPathProvider,
        path_mappings: list[tuple[str, str]],
        source_track_count: int,
    ) -> PlaylistExportResult:
        paths = provider.paths([addition.provider_track_id for addition in additions])
        entries = list(export.entries)
        missing = list(export.missing)
        for index, addition in enumerate(additions):
            position = source_track_count + index
            if index in paths:
                entries.append(
                    PlaylistFileEntry(
                        position,
                        "; ".join(addition.artists),
                        addition.title,
                        self._translate(paths[index], path_mappings),
                    )
                )
            else:
                missing.append(
                    MissingPlaylistEntry(
                        position,
                        SourceTrack(
                            addition.provider,
                            addition.provider_track_id,
                            addition.title,
                            addition.artists,
                            addition.album,
                        ),
                        "local_track_unavailable",
                    )
                )
        return PlaylistExportResult(tuple(entries), tuple(missing))
