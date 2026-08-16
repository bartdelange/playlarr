from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class PlaylistInfo:
    source: str
    id: str
    name: str
    path: str | None = None
    track_count: int | None = None
    is_followed: bool = False
    owner: str | None = None


@dataclass(frozen=True, slots=True)
class SourceTrack:
    source: str
    source_track_id: str
    title: str
    artists: tuple[str, ...]
    album: str
    isrc: str | None = None
    duration_ms: int | None = None


@dataclass(frozen=True, slots=True)
class AcquiredTrack:
    position: int
    track: SourceTrack
    skip_reason: str | None = None


@dataclass(frozen=True, slots=True)
class MusicBrainzResult:
    resolved_via: str | None = None
    recording_title: str = ""
    artist_names: tuple[str, ...] = ()
    recording_ids: tuple[str, ...] = ()
    release_ids: tuple[str, ...] = ()
    release_group_ids: tuple[str, ...] = ()
    artist_ids: tuple[str, ...] = ()
    primary_artist_id: str | None = None
    failure_reason: str = ""


@dataclass(slots=True)
class Summary:
    total: int = 0
    resolved_by_isrc: int = 0
    resolved_by_search: int = 0
    unresolved: int = 0
    lidarr_added: int = 0
    lidarr_updated: int = 0
    lidarr_skipped: int = 0


@dataclass(frozen=True, slots=True)
class LidarrPlanAction:
    """One inspectable Lidarr reconciliation decision.

    ``payload`` contains identifiers and preconditions, not an HTTP request body;
    the executor must rebuild and revalidate mutations against current state.
    """

    action: str
    artist_mbid: str = ""
    artist_name: str = ""
    release_group_id: str = ""
    album_title: str = ""
    reason: str = ""
    payload: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class LidarrPlan:
    actions: tuple[LidarrPlanAction, ...]

    @property
    def mutating_actions(self) -> tuple[LidarrPlanAction, ...]:
        return tuple(
            action
            for action in self.actions
            if action.action
            in {
                "create_artist",
                "monitor_artist",
                "create_release",
                "monitor_release",
                "queue_search",
            }
        )


@dataclass(frozen=True, slots=True)
class LidarrExecutionResult:
    action: LidarrPlanAction
    outcome: str
    details: str = ""


@dataclass(frozen=True, slots=True)
class MusicBrainzCandidate:
    result: MusicBrainzResult
    duration_ms: int | None = None
    isrcs: tuple[str, ...] = ()
    releases: tuple[dict[str, Any], ...] = ()
    score: float = 0.0
    evidence: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class ManualValidation:
    status: str
    candidate: MusicBrainzCandidate | None = None
    warnings: tuple[str, ...] = ()
    errors: tuple[str, ...] = ()
