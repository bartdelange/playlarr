"""Automatic MusicBrainz resolution orchestration."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from ..domain.models import MusicBrainzResult, SourceTrack, Summary


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


def _record_result(summary: Summary, result: MusicBrainzResult) -> None:
    if result.resolved_via == "isrc":
        summary.resolved_by_isrc += 1
    elif result.resolved_via:
        summary.resolved_by_search += 1
    else:
        summary.unresolved += 1


class ResolutionService:
    def __init__(self, resolver: TrackResolver):
        self.resolver = resolver

    def resolve_tracks(
        self,
        tracks: list[SourceTrack],
        progress: Callable[[ResolutionProgress], None] | None = None,
    ) -> ResolutionBatch:
        summary = Summary(total=len(tracks))
        results = []
        for number, track in enumerate(tracks, 1):
            if progress:
                progress(ResolutionProgress(number, len(tracks), track))
            result = self.resolver.resolve(track)
            results.append(result)
            _record_result(summary, result)
        return ResolutionBatch(tracks, results, summary)


class PersistentResolutionService:
    def __init__(self, repository):
        self.repository = repository

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
            _record_result(summary, result)
        self.repository.set_workflow_state(
            import_id, "review_required" if summary.unresolved else "ready_to_plan"
        )
        return summary
