import logging

from ..domain.models import PlaylistInfo
from ..integrations.sources.base import MusicSource

logger = logging.getLogger(__name__)


def select_playlist(source: MusicSource) -> PlaylistInfo:
    playlists = source.list_playlists()
    print(f"\nAvailable {source.name.title()} playlists:\n")
    for index, playlist in enumerate(playlists):
        label = f"{playlist.path} / {playlist.name}" if playlist.path else playlist.name
        count = f" ({playlist.track_count} tracks)" if playlist.track_count is not None else ""
        print(f"[{index}] {label}{count}")
    while True:
        raw = input("\nChoose an index, or paste a playlist ID or URL: ").strip()
        if not raw:
            print("Please enter an index, playlist ID, or URL.")
        elif raw.isdigit() and int(raw) < len(playlists):
            return playlists[int(raw)]
        else:
            try:
                return source.get_playlist(raw)
            except Exception as exc:
                print(f"Could not open that playlist: {exc}")
