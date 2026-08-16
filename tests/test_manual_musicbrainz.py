import unittest
from unittest.mock import Mock

from music_importer.domain.models import SourceTrack
from music_importer.integrations.musicbrainz import MusicBrainzClient


def client() -> MusicBrainzClient:
    return MusicBrainzClient("https://example.invalid", "test/1 (test@example.com)", 0, 1, 1)


def recording(**overrides):
    value = {
        "id": "123e4567-e89b-42d3-a456-426614174000",
        "title": "Strobe",
        "length": 600000,
        "isrcs": ["USABC1234567"],
        "artist-credit": [{"artist": {"id": "artist", "name": "deadmau5"}}],
        "releases": [
            {
                "id": "release",
                "title": "Strobe",
                "date": "2009-09-03",
                "release-group": {"id": "group", "title": "Strobe", "primary-type": "Single"},
            }
        ],
    }
    value.update(overrides)
    return value


class ManualMusicBrainzTests(unittest.TestCase):
    def test_rejects_invalid_mbid_without_request(self):
        resolver = client()
        resolver._get = Mock()

        validation = resolver.validate_recording_mbid(
            "not-an-mbid", SourceTrack("spotify", "track", "Strobe", ("deadmau5",), "Strobe")
        )

        self.assertEqual(validation.status, "invalid")
        resolver._get.assert_not_called()

    def test_validates_matching_recording_and_release_group(self):
        resolver = client()
        resolver._get = Mock(return_value=recording())
        track = SourceTrack(
            "spotify", "track", "Strobe", ("deadmau5",), "Strobe", "USABC1234567", 601200
        )

        validation = resolver.validate_recording_mbid("123e4567-e89b-42d3-a456-426614174000", track)

        self.assertEqual(validation.status, "valid")
        self.assertEqual(validation.candidate.result.release_group_ids, ("group",))
        self.assertEqual(validation.candidate.evidence["duration_delta_ms"], -1200)

    def test_suspicious_mapping_returns_warnings_before_acceptance(self):
        resolver = client()
        resolver._get = Mock(
            return_value=recording(
                title="Different",
                length=1000,
                isrcs=["OTHER12345678"],
                **{"artist-credit": [{"artist": {"id": "other", "name": "Other"}}]},
            )
        )
        track = SourceTrack(
            "spotify", "track", "Strobe", ("deadmau5",), "Strobe", "USABC1234567", 601200
        )

        validation = resolver.validate_recording_mbid("123e4567-e89b-42d3-a456-426614174000", track)

        self.assertEqual(validation.status, "warning")
        self.assertTrue(
            {"artist_differs", "title_differs", "duration_differs", "isrc_differs"}.issubset(
                validation.warnings
            )
        )

    def test_candidate_search_returns_ranked_evidence(self):
        resolver = client()
        resolver._get = Mock(
            return_value={
                "recordings": [
                    recording(score=50),
                    recording(
                        id="223e4567-e89b-42d3-a456-426614174000",
                        title="Unrelated",
                        score=100,
                        isrcs=[],
                        **{"artist-credit": [{"artist": {"id": "other", "name": "Other"}}]},
                    ),
                ]
            }
        )
        track = SourceTrack(
            "spotify", "track", "Strobe", ("deadmau5",), "Strobe", "USABC1234567", 600000
        )

        candidates = resolver.search_candidates(track)

        self.assertEqual(candidates[0].result.recording_title, "Strobe")
        self.assertTrue(candidates[0].evidence["isrc_match"])

    def test_candidate_search_prefers_extended_mix_over_radio_edit(self):
        resolver = client()
        resolver._get = Mock(
            return_value={
                "recordings": [
                    recording(id="123e4567-e89b-42d3-a456-426614174001", title="Song (radio edit)"),
                    recording(
                        id="123e4567-e89b-42d3-a456-426614174002",
                        title="Song (extended mix)",
                        score=80,
                    ),
                ]
            }
        )
        track = SourceTrack("spotify", "track", "Song", ("deadmau5",), "Album")

        candidates = resolver.search_candidates(track)

        self.assertEqual(candidates[0].result.recording_title, "Song (extended mix)")


if __name__ == "__main__":
    unittest.main()
