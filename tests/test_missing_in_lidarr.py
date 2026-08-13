import csv
import logging
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import requests

from music_importer.lidarr import LidarrClient
from music_importer.models import MusicBrainzResult, PlaylistInfo, Summary
from music_importer.reports import write_missing_report


class MissingInLidarrTests(unittest.TestCase):
    def test_finds_missing_artists_and_releases_and_caches_album_reads(self):
        client = object.__new__(LidarrClient)
        client._request = Mock(
            side_effect=[
                [{"id": 7, "foreignArtistId": "artist-present"}],
                [{"foreignAlbumId": "release-present"}],
                [],
            ]
        )
        results = [
            MusicBrainzResult(primary_artist_id="artist-absent", release_group_ids=("release-a",)),
            MusicBrainzResult(
                primary_artist_id="artist-present", release_group_ids=("release-absent",)
            ),
            MusicBrainzResult(
                primary_artist_id="artist-present", release_group_ids=("release-present",)
            ),
            MusicBrainzResult(),
        ]

        self.assertEqual(
            client.missing(results),
            {
                0: "artist_missing",
                1: "release_missing",
                2: "release_unmonitored_missing",
                3: "musicbrainz_unresolved",
            },
        )
        self.assertEqual(client._request.call_count, 3)

    def test_accepts_downloaded_alternate_version_with_same_normalized_title(self):
        client = object.__new__(LidarrClient)
        client._request = Mock(
            side_effect=[
                [{"id": 7, "foreignArtistId": "artist-present"}],
                [{"foreignAlbumId": "another-release"}],
                [
                    {
                        "title": "Whose Plan Is It",
                        "foreignRecordingId": "alternate-recording",
                        "hasFile": True,
                    }
                ],
            ]
        )
        result = MusicBrainzResult(
            recording_title="Whose Plan Is It (edit)",
            recording_ids=("playlist-recording",),
            primary_artist_id="artist-present",
            release_group_ids=("playlist-release",),
        )

        self.assertEqual(client.compare([result]), ({}, {0: "alternate_version_title_match"}))

    def test_does_not_accept_matching_title_without_a_downloaded_file(self):
        client = object.__new__(LidarrClient)
        client._request = Mock(
            side_effect=[
                [{"id": 7, "foreignArtistId": "artist-present"}],
                [{"foreignAlbumId": "another-release"}],
                [
                    {
                        "title": "Whose Plan Is It",
                        "foreignRecordingId": "alternate-recording",
                        "hasFile": False,
                    }
                ],
            ]
        )
        result = MusicBrainzResult(
            recording_title="Whose Plan Is It (edit)",
            primary_artist_id="artist-present",
            release_group_ids=("playlist-release",),
        )

        self.assertEqual(client.missing([result]), {0: "release_missing"})

    def test_reports_exact_release_as_matched_and_flags_unresolved(self):
        client = object.__new__(LidarrClient)
        client._request = Mock(
            side_effect=[
                [{"id": 7, "foreignArtistId": "artist-present"}],
                [{"foreignAlbumId": "release-present", "monitored": True}],
                [{"foreignRecordingId": "recording", "title": "Song", "hasFile": True}],
            ]
        )
        results = [
            MusicBrainzResult(
                recording_ids=("recording",),
                primary_artist_id="artist-present",
                release_group_ids=("release-present",),
            ),
            MusicBrainzResult(),
        ]

        self.assertEqual(
            client.compare(results), ({1: "musicbrainz_unresolved"}, {0: "release_downloaded"})
        )

    def test_reports_monitored_release_as_pending_until_track_is_downloaded(self):
        client = object.__new__(LidarrClient)
        client._request = Mock(
            side_effect=[
                [{"id": 7, "foreignArtistId": "artist-present"}],
                [{"foreignAlbumId": "release-present", "monitored": True}],
                [{"foreignRecordingId": "recording", "title": "Song", "hasFile": False}],
            ]
        )
        result = MusicBrainzResult(
            recording_title="Song",
            recording_ids=("recording",),
            primary_artist_id="artist-present",
            release_group_ids=("release-present",),
        )

        self.assertEqual(client.compare([result]), ({0: "release_monitored_missing"}, {}))

    def test_compare_reports_all_manual_intervention_reasons(self):
        client = object.__new__(LidarrClient)
        client._request = Mock(return_value=[])
        results = [
            MusicBrainzResult(),
            MusicBrainzResult(primary_artist_id="artist-only"),
            MusicBrainzResult(
                primary_artist_id="89ad4ac3-39f7-470e-963a-56509c546377",
                artist_names=("Various Artists",),
                release_group_ids=("group",),
            ),
        ]

        self.assertEqual(
            client.missing(results),
            {
                0: "musicbrainz_unresolved",
                1: "release_group_unresolved",
                2: "various_artists_skipped",
            },
        )

    def test_sync_skips_release_when_downloaded_alternate_version_exists(self):
        client = object.__new__(LidarrClient)
        client.config = Mock(lidarr_url="http://lidarr")
        client._request = Mock(
            side_effect=[
                [
                    {
                        "id": 7,
                        "foreignArtistId": "artist-present",
                        "monitored": True,
                        "monitorNewItems": "none",
                    }
                ],
                [
                    {
                        "title": "Whose Plan Is It",
                        "foreignRecordingId": "alternate-recording",
                        "hasFile": True,
                    }
                ],
                [{"id": 11, "foreignAlbumId": "playlist-release", "monitored": False}],
                None,
            ]
        )
        result = MusicBrainzResult(
            recording_title="Whose Plan Is It (edit)",
            recording_ids=("playlist-recording",),
            primary_artist_id="artist-present",
            release_group_ids=("playlist-release",),
        )
        summary = Summary(total=1)

        client.sync([result], summary)

        self.assertEqual(summary.lidarr_updated, 1)
        self.assertEqual(client._request.call_count, 4)
        self.assertEqual(
            client._request.call_args_list[3].kwargs["json"], {"albumIds": [11], "monitored": True}
        )

    def test_sync_consolidates_on_album_that_owns_downloaded_recording(self):
        client = object.__new__(LidarrClient)
        client.config = Mock(lidarr_url="http://lidarr")
        artist = {
            "id": 7,
            "artistName": "Artist",
            "foreignArtistId": "artist-mbid",
            "monitored": True,
            "monitorNewItems": "none",
        }
        tracks = [
            {
                "title": "Easy to Love",
                "foreignRecordingId": "recording-id",
                "albumId": 20,
                "hasFile": True,
            }
        ]
        albums = [
            {
                "id": 11,
                "title": "Random Compilation",
                "foreignAlbumId": "mapped-group",
                "monitored": True,
            },
            {
                "id": 20,
                "title": "Easy to Love",
                "foreignAlbumId": "downloaded-group",
                "monitored": True,
            },
        ]
        client._request = Mock(side_effect=[[artist], tracks, albums])
        summary = Summary(total=1)

        actions = client.sync(
            [
                MusicBrainzResult(
                    recording_title="Easy to Love",
                    recording_ids=("recording-id",),
                    artist_names=("Artist",),
                    primary_artist_id="artist-mbid",
                    release_group_ids=("mapped-group",),
                )
            ],
            summary,
        )

        self.assertEqual(client._request.call_count, 3)
        self.assertNotIn(
            ("PUT", "album/monitor"), [call.args for call in client._request.call_args_list]
        )
        self.assertNotIn(("POST", "album"), [call.args for call in client._request.call_args_list])
        self.assertNotIn(
            ("POST", "command"), [call.args for call in client._request.call_args_list]
        )
        consolidation = next(
            action for action in actions if action["action"] == "consolidate_release"
        )
        self.assertEqual(consolidation["release_group_id"], "downloaded-group")
        self.assertIn("mapped-group", consolidation["details"])

    def test_sync_still_searches_release_without_downloaded_match(self):
        client = object.__new__(LidarrClient)
        client.config = Mock()
        client._request = Mock(
            side_effect=[
                [
                    {
                        "id": 7,
                        "foreignArtistId": "artist-present",
                        "monitored": True,
                        "monitorNewItems": "none",
                    }
                ],
                [],
                [{"id": 11, "foreignAlbumId": "playlist-release", "monitored": False}],
                None,
                None,
            ]
        )
        result = MusicBrainzResult(
            recording_title="Missing Song",
            primary_artist_id="artist-present",
            release_group_ids=("playlist-release",),
        )
        summary = Summary(total=1)

        client.sync([result], summary)

        self.assertEqual(summary.lidarr_updated, 1)
        self.assertEqual(client._request.call_count, 5)

    def test_sync_adds_missing_release_then_monitors_and_searches_only_it(self):
        client = object.__new__(LidarrClient)
        client.config = Mock()
        artist = {
            "id": 7,
            "foreignArtistId": "artist-present",
            "artistName": "Artist",
            "monitored": True,
            "monitorNewItems": "none",
        }
        looked_up_album = {
            "foreignAlbumId": "playlist-release",
            "title": "Playlist Album",
            "artist": {"foreignArtistId": "artist-present"},
        }
        client._request = Mock(
            side_effect=[
                [artist],
                [],
                [],
                [],
                [looked_up_album],
                {"id": 11, "foreignAlbumId": "playlist-release", "monitored": False},
                None,
                None,
            ]
        )
        result = MusicBrainzResult(
            recording_title="Missing Song",
            primary_artist_id="artist-present",
            release_group_ids=("playlist-release",),
        )
        summary = Summary(total=1)

        client.sync([result], summary)

        self.assertEqual(summary.lidarr_updated, 1)
        self.assertEqual(client._request.call_args_list[3].args, ("GET", "album"))
        self.assertEqual(
            client._request.call_args_list[3].kwargs["params"],
            {"foreignAlbumId": "playlist-release"},
        )
        album_post = client._request.call_args_list[5]
        self.assertEqual(album_post.args, ("POST", "album"))
        self.assertEqual(album_post.kwargs["json"]["artist"], artist)
        self.assertFalse(album_post.kwargs["json"]["monitored"])
        self.assertEqual(
            client._request.call_args_list[6].kwargs["json"], {"albumIds": [11], "monitored": True}
        )
        self.assertEqual(
            client._request.call_args_list[7].kwargs["json"],
            {"name": "AlbumSearch", "albumIds": [11]},
        )

    def test_sync_reuses_release_that_exists_under_another_artist(self):
        client = object.__new__(LidarrClient)
        client.config = Mock()
        artist = {
            "id": 7,
            "foreignArtistId": "track-artist",
            "monitored": True,
            "monitorNewItems": "none",
        }
        existing_album = {"id": 19, "foreignAlbumId": "compilation", "monitored": False}
        client._request = Mock(
            side_effect=[
                [artist],
                [],
                [],
                [existing_album],
                None,
                None,
            ]
        )
        summary = Summary(total=1)

        client.sync(
            [
                MusicBrainzResult(
                    primary_artist_id="track-artist", release_group_ids=("compilation",)
                )
            ],
            summary,
        )

        self.assertNotIn(("POST", "album"), [call.args for call in client._request.call_args_list])
        self.assertEqual(
            client._request.call_args_list[4].kwargs["json"], {"albumIds": [19], "monitored": True}
        )
        self.assertEqual(
            client._request.call_args_list[5].kwargs["json"],
            {"name": "AlbumSearch", "albumIds": [19]},
        )
        self.assertEqual(summary.lidarr_updated, 1)

    def test_sync_does_not_monitor_album_owned_by_various_artists(self):
        client = object.__new__(LidarrClient)
        client.config = Mock(lidarr_url="http://lidarr")
        artist = {
            "id": 7,
            "artistName": "Sound Rush",
            "foreignArtistId": "sound-rush",
            "monitored": True,
            "monitorNewItems": "none",
        }
        compilation = {
            "id": 19,
            "title": "Festival Compilation",
            "foreignAlbumId": "compilation",
            "monitored": False,
            "artist": {
                "artistName": "Various Artists",
                "foreignArtistId": "89ad4ac3-39f7-470e-963a-56509c546377",
            },
        }
        client._request = Mock(side_effect=[[artist], [], [], [compilation]])
        summary = Summary(total=1)

        actions = client.sync(
            [
                MusicBrainzResult(
                    artist_names=("Sound Rush",),
                    primary_artist_id="sound-rush",
                    release_group_ids=("compilation",),
                )
            ],
            summary,
        )

        self.assertNotIn(
            ("PUT", "album/monitor"), [call.args for call in client._request.call_args_list]
        )
        self.assertNotIn(("POST", "album"), [call.args for call in client._request.call_args_list])
        skipped = next(action for action in actions if action["action"] == "skip_album")
        self.assertEqual(skipped["release_group_id"], "compilation")
        self.assertIn("Various Artists", skipped["details"])

    def test_sync_does_not_add_various_artists_album_from_lookup(self):
        client = object.__new__(LidarrClient)
        client.config = Mock(lidarr_url="http://lidarr")
        artist = {
            "id": 7,
            "artistName": "Sound Rush",
            "foreignArtistId": "sound-rush",
            "monitored": True,
            "monitorNewItems": "none",
        }
        lookup = {
            "title": "Festival Compilation",
            "foreignAlbumId": "compilation",
            "artist": {
                "artistName": "Various Artists",
                "foreignArtistId": "89ad4ac3-39f7-470e-963a-56509c546377",
            },
        }
        client._request = Mock(side_effect=[[artist], [], [], [], [lookup]])
        summary = Summary(total=1)

        actions = client.sync(
            [
                MusicBrainzResult(
                    artist_names=("Sound Rush",),
                    primary_artist_id="sound-rush",
                    release_group_ids=("compilation",),
                )
            ],
            summary,
        )

        self.assertNotIn(("POST", "album"), [call.args for call in client._request.call_args_list])
        skipped = next(action for action in actions if action["action"] == "skip_album")
        self.assertEqual(skipped["details"], "album lookup belongs to Various Artists")

    def test_new_artist_payload_uses_lookup_metadata_and_conservative_monitoring(self):
        client = object.__new__(LidarrClient)
        client.config = Mock(
            lidarr_quality_profile_id=2, lidarr_metadata_profile_id=3, lidarr_root_folder="/music"
        )
        lookup = {"artistName": "Artist", "foreignArtistId": "artist-mbid", "images": []}
        created = {"id": 7, "artistName": "Artist", "foreignArtistId": "artist-mbid"}
        albums = [
            {"id": 11, "foreignAlbumId": "release-a", "monitored": False},
            {"id": 12, "foreignAlbumId": "release-b", "monitored": False},
        ]
        client._request = Mock(side_effect=[[], [lookup], created, [], albums, None, None, None])
        summary = Summary(total=1)

        client.sync(
            [
                MusicBrainzResult(
                    primary_artist_id="artist-mbid", release_group_ids=("release-b", "release-a")
                )
            ],
            summary,
        )

        payload = client._request.call_args_list[2].kwargs["json"]
        self.assertEqual(payload["artistName"], "Artist")
        self.assertFalse(payload["monitored"])
        self.assertEqual(payload["monitorNewItems"], "none")
        self.assertEqual(
            payload["addOptions"],
            {
                "monitor": "none",
                "monitored": False,
                "albumsToMonitor": [],
                "searchForMissingAlbums": False,
            },
        )
        self.assertEqual(summary.lidarr_added, 1)
        artist_update = client._request.call_args_list[7]
        self.assertEqual(artist_update.args, ("PUT", "artist/7"))
        self.assertTrue(artist_update.kwargs["json"]["monitored"])
        self.assertEqual(artist_update.kwargs["json"]["monitorNewItems"], "none")

    def test_new_artist_preserves_unrelated_albums_and_searches_only_requested(self):
        client = object.__new__(LidarrClient)
        client.config = Mock(
            lidarr_quality_profile_id=2, lidarr_metadata_profile_id=3, lidarr_root_folder="/music"
        )
        lookup = {"artistName": "Artist", "foreignArtistId": "artist-mbid"}
        created = {"id": 7, "artistName": "Artist", "foreignArtistId": "artist-mbid"}
        albums = [
            {"id": 10, "foreignAlbumId": "unrelated-a", "monitored": True},
            {"id": 11, "foreignAlbumId": "requested-a", "monitored": True},
            {"id": 12, "foreignAlbumId": "unrelated-b", "monitored": False},
            {"id": 13, "foreignAlbumId": "requested-b", "monitored": False},
            {"id": 14, "foreignAlbumId": "unrelated-c", "monitored": True},
        ]
        client._request = Mock(
            side_effect=[
                [],
                [lookup],
                created,
                [],
                albums,
                None,
                None,
                None,
            ]
        )
        summary = Summary(total=2)

        client.sync(
            [
                MusicBrainzResult(
                    primary_artist_id="artist-mbid", release_group_ids=("requested-a",)
                ),
                MusicBrainzResult(
                    primary_artist_id="artist-mbid", release_group_ids=("requested-b",)
                ),
            ],
            summary,
        )

        calls = client._request.call_args_list
        self.assertEqual(calls[5].args, ("PUT", "album/monitor"))
        self.assertEqual(calls[5].kwargs["json"], {"albumIds": [13], "monitored": True})
        self.assertEqual(calls[6].args, ("POST", "command"))
        self.assertEqual(calls[6].kwargs["json"], {"name": "AlbumSearch", "albumIds": [11, 13]})
        self.assertEqual(calls[7].args, ("PUT", "artist/7"))
        self.assertTrue(calls[7].kwargs["json"]["monitored"])
        self.assertEqual(calls[7].kwargs["json"]["monitorNewItems"], "none")
        self.assertFalse(
            any(
                call.kwargs.get("json") == {"albumIds": [10, 14], "monitored": False}
                for call in calls
            )
        )
        self.assertEqual(summary.lidarr_added, 1)
        self.assertEqual(summary.lidarr_updated, 0)
        self.assertEqual(summary.lidarr_skipped, 0)

    def test_resume_preserves_unrelated_albums_for_existing_artist(self):
        client = object.__new__(LidarrClient)
        client.config = Mock()
        artist = {
            "id": 7,
            "foreignArtistId": "artist-mbid",
            "monitored": False,
            "monitorNewItems": "all",
        }
        albums = [
            {"id": 11, "foreignAlbumId": "requested", "monitored": False},
            {"id": 12, "foreignAlbumId": "old-unrelated", "monitored": True},
            {"id": 13, "foreignAlbumId": "future-unrelated", "monitored": True},
        ]
        client._request = Mock(
            side_effect=[
                [artist],
                [],
                albums,
                None,
                None,
                None,
            ]
        )
        summary = Summary(total=1)

        client.sync(
            [
                MusicBrainzResult(
                    artist_names=("Mapped Artist",),
                    primary_artist_id="artist-mbid",
                    release_group_ids=("requested",),
                )
            ],
            summary,
        )

        calls = client._request.call_args_list
        self.assertEqual(calls[3].kwargs["json"], {"albumIds": [11], "monitored": True})
        self.assertEqual(calls[4].kwargs["json"], {"name": "AlbumSearch", "albumIds": [11]})
        self.assertEqual(calls[5].args, ("PUT", "artist/7"))
        self.assertTrue(calls[5].kwargs["json"]["monitored"])
        self.assertEqual(calls[5].kwargs["json"]["monitorNewItems"], "none")
        self.assertFalse(
            any(
                call.kwargs.get("json") == {"albumIds": [12, 13], "monitored": False}
                for call in calls
            )
        )

    def test_sync_never_touches_various_artists(self):
        client = object.__new__(LidarrClient)
        client.config = Mock()
        client._request = Mock(return_value=[])
        summary = Summary(total=2)

        client.sync(
            [
                MusicBrainzResult(
                    primary_artist_id="89ad4ac3-39f7-470e-963a-56509c546377",
                    artist_names=("Various Artists",),
                    release_group_ids=("release-a",),
                ),
                MusicBrainzResult(
                    primary_artist_id="different-id",
                    artist_names=("Various Artists",),
                    release_group_ids=("release-b",),
                ),
            ],
            summary,
        )

        client._request.assert_called_once_with("GET", "artist")
        self.assertEqual(summary.lidarr_added, 0)
        self.assertEqual(summary.lidarr_updated, 0)

    def test_resume_is_idempotent_after_monitoring_state_has_converged(self):
        client = object.__new__(LidarrClient)
        client.config = Mock(lidarr_url="http://lidarr")
        artist = {
            "id": 7,
            "foreignArtistId": "artist-mbid",
            "monitored": True,
            "monitorNewItems": "none",
        }
        albums = [
            {"id": 11, "foreignAlbumId": "requested", "monitored": True},
            {"id": 12, "foreignAlbumId": "old-unrelated", "monitored": False},
            {"id": 13, "foreignAlbumId": "future-unrelated", "monitored": False},
        ]
        client._request = Mock(side_effect=[[artist], [], albums])
        summary = Summary(total=1)

        actions = client.sync(
            [
                MusicBrainzResult(
                    artist_names=("Mapped Artist",),
                    primary_artist_id="artist-mbid",
                    release_group_ids=("requested",),
                )
            ],
            summary,
        )

        self.assertEqual(
            [call.args[:2] for call in client._request.call_args_list],
            [
                ("GET", "artist"),
                ("GET", "track"),
                ("GET", "album"),
            ],
        )
        self.assertEqual(summary.lidarr_skipped, 1)
        self.assertEqual(
            actions,
            [
                {
                    "mapped_artist_names": "Mapped Artist",
                    "artist_name": "artist-mbid",
                    "artist_mbid": "artist-mbid",
                    "artist_lidarr_url": "http://lidarr/artist/artist-mbid",
                    "release_group_id": "",
                    "album_title": "",
                    "album_lidarr_url": "",
                    "action": "reconcile_artist",
                    "outcome": "unchanged",
                    "details": "",
                }
            ],
        )

    def test_sync_does_not_act_without_a_resolved_release_group(self):
        client = object.__new__(LidarrClient)
        client.config = Mock()
        client._request = Mock(return_value=[])
        summary = Summary(total=2)

        client.sync(
            [MusicBrainzResult(), MusicBrainzResult(primary_artist_id="artist-only")], summary
        )

        client._request.assert_called_once_with("GET", "artist")
        self.assertEqual(summary.lidarr_added, 0)
        self.assertEqual(summary.lidarr_updated, 0)

    def test_request_logs_lidarr_error_response_body(self):
        client = object.__new__(LidarrClient)
        client.config = Mock(lidarr_url="http://lidarr")
        response = requests.Response()
        response.status_code = 400
        response._content = b'{"error":"ArtistName is required"}'
        response.url = "http://lidarr/api/v1/artist"
        client.session = Mock()
        client.session.request.return_value = response

        with self.assertLogs("music_importer.lidarr", logging.ERROR) as captured:
            with self.assertRaises(requests.HTTPError):
                client._request("POST", "artist", json={})

        self.assertIn("ArtistName is required", captured.output[0])

    def test_writes_missing_rows_with_reason(self):
        playlist = PlaylistInfo(source="spotify", id="playlist-id", name="My Playlist")
        rows = [
            {
                "source": "spotify",
                "source_playlist_id": "playlist-id",
                "source_track_id": "track-id",
                "track_title": "Song",
                "artists": "Artist",
                "album": "Album",
                "isrc": "",
                "resolved_via": "search",
                "mb_recording_title": "Song",
                "mb_artist_names": "Artist",
                "mb_recording_ids": "recording",
                "mb_release_ids": "release",
                "mb_release_group_ids": "group",
                "mb_artist_ids": "artist",
                "mb_primary_artist_id": "artist",
                "failure_reason": "",
            }
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = write_missing_report(Path(directory), playlist, rows, {0: "release_missing"})
            with path.open(newline="", encoding="utf-8") as handle:
                written = list(csv.DictReader(handle))

        self.assertEqual(written[0]["source_track_id"], "track-id")
        self.assertEqual(written[0]["lidarr_missing_reason"], "release_missing")


if __name__ == "__main__":
    unittest.main()
