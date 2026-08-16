"""Source-neutral playlist acquisition services."""

from ..domain.models import AcquiredTrack, PlaylistInfo, SourceTrack
from ..integrations.sources.base import MusicSource


class PlaylistService:
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


class PersistentAcquisitionService:
    """Coordinate durable acquisition without presentation concerns."""

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
            entries = (
                source.get_entries(playlist)
                if hasattr(source, "get_entries")
                else [
                    AcquiredTrack(position, track)
                    for position, track in enumerate(source.get_tracks(playlist))
                ]
            )
            self.repository.replace_acquired_tracks(import_id, entries)
        except Exception as exc:
            self.repository.set_workflow_state(import_id, "acquisition_failed", str(exc))
            raise
