"""Durable records returned by the SQLite repository."""

from dataclasses import dataclass

from ..domain.models import MusicBrainzResult, SourceTrack


@dataclass(frozen=True, slots=True)
class StoredImport:
    id: str
    source: str
    source_playlist_id: str
    playlist_name: str
    playlist_path: str | None
    workflow_state: str
    created_at: str
    updated_at: str
    last_error: str | None = None


@dataclass(frozen=True, slots=True)
class StoredEntry:
    id: int
    import_id: str
    position: int
    track: SourceTrack
    resolution_state: str
    result: MusicBrainzResult
    resolution_method: str | None
    evidence: dict
    is_manual: bool
    validation_status: str | None
    selected_release_group_id: str | None


@dataclass(frozen=True, slots=True)
class StoredJob:
    id: str
    import_id: str | None
    kind: str
    status: str
    current: int
    total: int
    current_item: str | None
    cancel_requested: bool
    error: str | None


@dataclass(frozen=True, slots=True)
class ManualMatchSuggestion:
    entry: StoredEntry
    playlist_name: str


@dataclass(frozen=True, slots=True)
class PlaylistUpdate:
    added: int
    removed: int
    moved: int
    unchanged: int


@dataclass(frozen=True, slots=True)
class PlaylistRevision:
    id: str
    created_at: str
    added: int
    removed: int
    moved: int
    unchanged: int
