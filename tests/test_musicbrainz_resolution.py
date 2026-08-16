import unittest
from unittest.mock import Mock

from music_importer.domain.models import MusicBrainzResult, SourceTrack
from music_importer.integrations.musicbrainz import MusicBrainzClient


def client() -> MusicBrainzClient:
    return MusicBrainzClient("https://example.invalid", "test/1 (test@example.com)", 0, 1, 1)


class MusicBrainzResolutionCharacterizationTests(unittest.TestCase):
    def test_valid_isrc_is_preferred_and_stops_fallback_search(self):
        resolver = client()
        resolver._by_isrc = Mock(return_value=MusicBrainzResult(resolved_via="isrc"))
        resolver._by_search = Mock()
        track = SourceTrack("spotify", "track", "Song", ("Artist",), "Album", "US-ABC-12-34567")

        result = resolver.resolve(track)

        self.assertEqual(result.resolved_via, "isrc")
        resolver._by_isrc.assert_called_once_with("USABC1234567", track)
        resolver._by_search.assert_not_called()

    def test_invalid_isrc_falls_back_and_retains_audit_reason_on_failure(self):
        resolver = client()
        resolver._by_isrc = Mock()
        resolver._by_search = Mock(return_value=None)
        track = SourceTrack("spotify", "track", "Song", ("Artist",), "Album", "bad")

        result = resolver.resolve(track)

        resolver._by_isrc.assert_not_called()
        resolver._by_search.assert_called_once_with(track)
        self.assertEqual(result.failure_reason, "invalid_isrc;search_empty")

    def test_metadata_search_rejects_a_different_artist(self):
        resolver = client()
        resolver._get = Mock(
            return_value={
                "recordings": [
                    {
                        "id": "recording",
                        "title": "Exact Song",
                        "score": 100,
                        "artist-credit": [{"artist": {"id": "other", "name": "Other Artist"}}],
                        "releases": [],
                    }
                ]
            }
        )
        track = SourceTrack("spotify", "track", "Exact Song", ("Wanted Artist",), "Album")

        self.assertIsNone(resolver._by_search(track))

    def test_metadata_search_does_not_drop_a_requested_version_marker(self):
        resolver = client()
        resolver._get = Mock(
            return_value={
                "recordings": [
                    {
                        "id": "recording",
                        "title": "Song",
                        "score": 100,
                        "artist-credit": [{"artist": {"id": "artist", "name": "Artist"}}],
                        "releases": [],
                    }
                ]
            }
        )
        track = SourceTrack("spotify", "track", "Song (Extended Mix)", ("Artist",), "Album")

        self.assertIsNone(resolver._by_search(track))

    def test_metadata_search_prefers_extended_mix_for_same_song(self):
        resolver = client()
        resolver._get = Mock(
            return_value={
                "recordings": [
                    {
                        "id": "radio-recording",
                        "title": "Song (radio edit)",
                        "score": 100,
                        "artist-credit": [{"artist": {"id": "artist", "name": "Artist"}}],
                        "releases": [],
                    },
                    {
                        "id": "extended-recording",
                        "title": "Song (extended mix)",
                        "score": 80,
                        "artist-credit": [{"artist": {"id": "artist", "name": "Artist"}}],
                        "releases": [],
                    },
                    {
                        "id": "original-recording",
                        "title": "Song",
                        "score": 100,
                        "artist-credit": [{"artist": {"id": "artist", "name": "Artist"}}],
                        "releases": [],
                    },
                ]
            }
        )
        track = SourceTrack("spotify", "track", "Song", ("Artist",), "Album")

        result = resolver._by_search(track)

        self.assertEqual(result.recording_ids, ("extended-recording",))


if __name__ == "__main__":
    unittest.main()
