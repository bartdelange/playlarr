import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from music_importer.domain.models import LidarrPlan, LidarrPlanAction, MusicBrainzResult
from music_importer.integrations.lidarr import LidarrClient


class LidarrPlanningTests(unittest.TestCase):
    def test_plan_is_read_only_and_describes_missing_existing_release(self):
        client = object.__new__(LidarrClient)
        client.config = SimpleNamespace(lidarr_url="http://lidarr")
        artist = {
            "id": 7,
            "artistName": "Artist",
            "foreignArtistId": "artist",
            "monitored": True,
            "monitorNewItems": "none",
        }
        lookup = {
            "foreignAlbumId": "group",
            "title": "Album",
            "artist": {"foreignArtistId": "artist"},
        }
        client._request = Mock(side_effect=[[artist], [], [], [], [lookup]])

        plan = client.plan(
            [
                MusicBrainzResult(
                    resolved_via="isrc",
                    recording_title="Song",
                    artist_names=("Artist",),
                    primary_artist_id="artist",
                    release_group_ids=("group",),
                )
            ]
        )

        self.assertEqual(
            [action.action for action in plan.actions],
            ["create_release", "monitor_release", "queue_search"],
        )
        self.assertTrue(all(call.args[0] == "GET" for call in client._request.call_args_list))

    def test_plan_reuses_downloaded_canonical_release_without_search(self):
        client = object.__new__(LidarrClient)
        client.config = SimpleNamespace(lidarr_url="http://lidarr")
        artist = {
            "id": 7,
            "artistName": "Artist",
            "foreignArtistId": "artist",
            "monitored": True,
            "monitorNewItems": "none",
        }
        tracks = [
            {
                "id": 44,
                "foreignRecordingId": "recording",
                "title": "Song (Edit)",
                "trackNumber": "2-07",
                "albumId": 20,
                "hasFile": True,
                "trackFileId": 91,
            }
        ]
        albums = [
            {"id": 20, "foreignAlbumId": "downloaded-group", "title": "Album", "monitored": True}
        ]
        client._request = Mock(side_effect=[[artist], tracks, albums])

        plan = client.plan(
            [
                MusicBrainzResult(
                    recording_ids=("recording",),
                    recording_title="Song",
                    artist_names=("Artist",),
                    primary_artist_id="artist",
                    release_group_ids=("mapped-group",),
                )
            ]
        )

        self.assertEqual([action.action for action in plan.actions], ["reuse_downloaded_release"])
        self.assertEqual(plan.actions[0].release_group_id, "downloaded-group")
        self.assertEqual(
            plan.actions[0].payload["matched_track"],
            {
                "id": 44,
                "title": "Song (Edit)",
                "track_number": "2-07",
                "foreign_recording_id": "recording",
                "track_file_id": 91,
                "has_file": True,
                "match_method": "recording_id",
            },
        )
        self.assertTrue(all(call.args[0] == "GET" for call in client._request.call_args_list))

    def test_downloaded_recording_does_not_monitor_unmonitored_release(self):
        client = object.__new__(LidarrClient)
        client.config = SimpleNamespace(lidarr_url="http://lidarr")
        artist = {
            "id": 7,
            "artistName": "Artist",
            "foreignArtistId": "artist",
            "monitored": True,
            "monitorNewItems": "none",
        }
        tracks = [
            {"foreignRecordingId": "recording", "title": "Song", "albumId": 20, "hasFile": True}
        ]
        albums = [
            {"id": 20, "foreignAlbumId": "downloaded-group", "title": "Album", "monitored": False}
        ]
        client._request = Mock(side_effect=[[artist], tracks, albums])

        plan = client.plan(
            [
                MusicBrainzResult(
                    recording_ids=("recording",),
                    recording_title="Song",
                    artist_names=("Artist",),
                    primary_artist_id="artist",
                    release_group_ids=("mapped-group",),
                )
            ]
        )

        self.assertEqual([action.action for action in plan.actions], ["reuse_downloaded_release"])
        self.assertNotIn("monitor_release", [action.action for action in plan.actions])

    def test_plan_recognizes_downloaded_track_on_globally_owned_album(self):
        client = object.__new__(LidarrClient)
        artist = {
            "id": 7,
            "artistName": "Track Artist",
            "foreignArtistId": "track-artist",
            "monitored": True,
            "monitorNewItems": "none",
        }
        global_album = {
            "id": 20,
            "foreignAlbumId": "selected-group",
            "title": "Globally Owned Album",
            "monitored": True,
            "artistId": 9,
            "artist": {"foreignArtistId": "album-artist"},
        }
        global_track = {
            "id": 44,
            "albumId": 20,
            "foreignRecordingId": "recording",
            "title": "Song",
            "hasFile": True,
            "trackFileId": 91,
        }
        client._request = Mock(side_effect=[[artist], [], [], [global_album], [global_track]])

        plan = client.plan(
            [
                MusicBrainzResult(
                    recording_ids=("recording",),
                    recording_title="Song",
                    artist_names=("Track Artist",),
                    primary_artist_id="track-artist",
                    release_group_ids=("selected-group",),
                )
            ]
        )

        release_action = next(action for action in plan.actions if action.release_group_id)
        self.assertEqual(release_action.action, "unchanged")
        self.assertEqual(release_action.reason, "requested_recording_downloaded")
        self.assertEqual(release_action.payload["matched_track"]["track_file_id"], 91)
        self.assertFalse(plan.mutating_actions)

    def test_release_mutations_identify_only_the_missing_recording(self):
        client = object.__new__(LidarrClient)
        client.config = SimpleNamespace(lidarr_url="http://lidarr")
        artist = {
            "id": 7,
            "artistName": "Artist",
            "foreignArtistId": "artist",
            "monitored": True,
            "monitorNewItems": "none",
        }
        tracks = [
            {
                "foreignRecordingId": "downloaded",
                "title": "Downloaded",
                "albumId": 20,
                "hasFile": True,
            }
        ]
        albums = [{"id": 20, "foreignAlbumId": "group", "title": "Album", "monitored": False}]
        client._request = Mock(side_effect=[[artist], tracks, albums])

        plan = client.plan(
            [
                MusicBrainzResult(
                    recording_ids=("downloaded",),
                    recording_title="Downloaded",
                    artist_names=("Artist",),
                    primary_artist_id="artist",
                    release_group_ids=("other-edition",),
                ),
                MusicBrainzResult(
                    recording_ids=("missing",),
                    recording_title="Missing",
                    artist_names=("Artist",),
                    primary_artist_id="artist",
                    release_group_ids=("group",),
                ),
            ]
        )

        mutations = [
            action
            for action in plan.actions
            if action.action in {"monitor_release", "queue_search"}
        ]
        self.assertEqual(len(mutations), 2)
        self.assertTrue(
            all(action.payload["requested_recording_ids"] == ["missing"] for action in mutations)
        )

    def test_plan_reconfigures_automatic_release_switching_for_selected_edition(self):
        client = object.__new__(LidarrClient)
        artist = {
            "id": 7,
            "artistName": "Artist",
            "foreignArtistId": "artist",
            "monitored": True,
            "monitorNewItems": "none",
        }
        album = {
            "id": 20,
            "foreignAlbumId": "group",
            "title": "Album",
            "monitored": True,
            "anyReleaseOk": True,
            "releases": [
                {"foreignReleaseId": "original-release", "monitored": True},
                {"foreignReleaseId": "extended-release", "monitored": False},
            ],
        }
        client._request = Mock(side_effect=[[artist], [], [album]])

        plan = client.plan(
            [
                MusicBrainzResult(
                    recording_ids=("extended-recording",),
                    recording_title="Song (extended mix)",
                    artist_names=("Artist",),
                    primary_artist_id="artist",
                    release_ids=("extended-release",),
                    release_group_ids=("group",),
                )
            ]
        )

        monitor = next(action for action in plan.actions if action.action == "monitor_release")
        self.assertEqual(monitor.payload["requested_release_ids"], ["extended-release"])

    def test_monitored_release_still_queues_search_for_missing_recording(self):
        client = object.__new__(LidarrClient)
        artist = {
            "id": 7,
            "artistName": "Artist",
            "foreignArtistId": "artist",
            "monitored": True,
            "monitorNewItems": "none",
        }
        album = {"id": 20, "foreignAlbumId": "group", "title": "Album", "monitored": True}
        track = {
            "foreignRecordingId": "missing",
            "title": "Missing",
            "albumId": 20,
            "hasFile": False,
        }
        client._request = Mock(side_effect=[[artist], [track], [album]])

        plan = client.plan(
            [
                MusicBrainzResult(
                    recording_ids=("missing",),
                    recording_title="Missing",
                    artist_names=("Artist",),
                    primary_artist_id="artist",
                    release_group_ids=("group",),
                )
            ]
        )

        self.assertEqual([action.action for action in plan.actions], ["unchanged", "queue_search"])
        self.assertEqual(plan.actions[1].payload["requested_recording_ids"], ["missing"])

    def test_plan_skips_various_artists_without_lookup_or_mutation(self):
        client = object.__new__(LidarrClient)
        client._request = Mock(return_value=[])

        plan = client.plan(
            [
                MusicBrainzResult(
                    artist_names=("Various Artists",),
                    primary_artist_id="89ad4ac3-39f7-470e-963a-56509c546377",
                    release_group_ids=("group",),
                )
            ]
        )

        self.assertEqual(plan.actions[0].reason, "various_artists_skipped")
        client._request.assert_called_once_with("GET", "artist")

    def test_plan_allows_explicit_recording_scoped_various_artists_override(self):
        client = object.__new__(LidarrClient)
        artist = {
            "id": 7,
            "foreignArtistId": "artist",
            "artistName": "Artist",
            "monitored": True,
            "monitorNewItems": "none",
        }
        compilation = {
            "id": 19,
            "foreignAlbumId": "compilation",
            "title": "Compilation",
            "monitored": False,
            "artist": {
                "artistName": "Various Artists",
                "foreignArtistId": "89ad4ac3-39f7-470e-963a-56509c546377",
            },
        }
        client._request = Mock(side_effect=[[artist], [], [compilation], [compilation]])

        plan = client.plan(
            [
                MusicBrainzResult(
                    recording_ids=("recording",),
                    recording_title="Song",
                    artist_names=("Artist",),
                    primary_artist_id="artist",
                    release_group_ids=("compilation",),
                )
            ],
            allow_various_artists_recordings={"recording"},
        )

        self.assertNotIn("skip", [action.action for action in plan.actions])
        mutations = [
            action
            for action in plan.actions
            if action.action in {"monitor_release", "queue_search"}
        ]
        self.assertEqual(len(mutations), 2)
        self.assertTrue(
            all(action.payload["allow_various_artists_release"] for action in mutations)
        )

    def test_downloaded_tracks_on_shared_release_get_recording_scoped_outcomes(self):
        client = object.__new__(LidarrClient)
        artist = {
            "id": 7,
            "foreignArtistId": "artist",
            "artistName": "Artist",
            "monitored": True,
            "monitorNewItems": "none",
        }
        album = {
            "id": 11,
            "foreignAlbumId": "canonical",
            "title": "Album",
            "monitored": True,
            "artist": {"foreignArtistId": "artist"},
        }
        tracks = [
            {
                "albumId": 11,
                "title": "Reused",
                "hasFile": True,
                "foreignRecordingId": "reused-recording",
            },
            {
                "albumId": 11,
                "title": "Already Here",
                "hasFile": True,
                "foreignRecordingId": "existing-recording",
            },
        ]
        client._request = Mock(side_effect=[[artist], tracks, [album]])

        plan = client.plan(
            [
                MusicBrainzResult(
                    recording_ids=("reused-recording",),
                    recording_title="Reused",
                    artist_names=("Artist",),
                    primary_artist_id="artist",
                    release_group_ids=("compilation",),
                ),
                MusicBrainzResult(
                    recording_ids=("existing-recording",),
                    recording_title="Already Here",
                    artist_names=("Artist",),
                    primary_artist_id="artist",
                    release_group_ids=("canonical",),
                ),
            ]
        )

        reused = next(
            action for action in plan.actions if action.action == "reuse_downloaded_release"
        )
        unchanged = next(
            action
            for action in plan.actions
            if action.action == "unchanged" and action.release_group_id == "canonical"
        )
        self.assertEqual(reused.payload["requested_recording_ids"], ["reused-recording"])
        self.assertEqual(unchanged.payload["requested_recording_ids"], ["existing-recording"])


class LidarrExecutionTests(unittest.TestCase):
    def test_execution_corresponds_to_approved_plan(self):
        client = object.__new__(LidarrClient)
        client.config = SimpleNamespace(
            lidarr_url="http://lidarr",
            lidarr_quality_profile_id=1,
            lidarr_metadata_profile_id=1,
            lidarr_root_folder="/music",
        )
        unmonitored = {
            "id": 11,
            "foreignAlbumId": "group",
            "title": "Album",
            "monitored": False,
            "artist": {"foreignArtistId": "artist"},
        }
        client._request = Mock(side_effect=[[unmonitored], None, None])
        plan = LidarrPlan(
            (
                LidarrPlanAction("monitor_release", "artist", "Artist", "group"),
                LidarrPlanAction("queue_search", "artist", "Artist", "group"),
            )
        )

        execution = client.execute_plan(plan)

        self.assertEqual([result.outcome for result in execution], ["updated", "queued"])
        mutation_calls = [
            call for call in client._request.call_args_list if call.args[0] in {"PUT", "POST"}
        ]
        self.assertEqual(mutation_calls[0].args, ("PUT", "album/11"))
        self.assertEqual(mutation_calls[1].args, ("POST", "command"))
        album_reads = [
            call for call in client._request.call_args_list if call.args[:2] == ("GET", "album")
        ]
        self.assertEqual(len(album_reads), 1)

    def test_execution_reuses_artist_read_and_updated_state(self):
        client = object.__new__(LidarrClient)
        client.config = SimpleNamespace(lidarr_url="http://lidarr")
        artist = {
            "id": 7,
            "foreignArtistId": "artist",
            "artistName": "Artist",
            "monitored": False,
            "monitorNewItems": "all",
        }
        client._request = Mock(side_effect=[[artist], None])
        plan = LidarrPlan(
            (
                LidarrPlanAction("monitor_artist", "artist", "Artist"),
                LidarrPlanAction("monitor_artist", "artist", "Artist"),
            )
        )

        execution = client.execute_plan(plan)

        self.assertEqual([result.outcome for result in execution], ["updated", "unchanged"])
        artist_reads = [
            call for call in client._request.call_args_list if call.args[:2] == ("GET", "artist")
        ]
        self.assertEqual(len(artist_reads), 1)

    def test_execution_disables_switching_and_selects_requested_release(self):
        client = object.__new__(LidarrClient)
        album = {
            "id": 11,
            "foreignAlbumId": "group",
            "title": "Album",
            "monitored": True,
            "anyReleaseOk": True,
            "artist": {"foreignArtistId": "artist"},
            "releases": [
                {"foreignReleaseId": "original-release", "monitored": True},
                {"foreignReleaseId": "extended-release", "monitored": False},
            ],
        }
        client._request = Mock(side_effect=[[album], None])
        action = LidarrPlanAction(
            "monitor_release",
            "artist",
            "Artist",
            "group",
            payload={"requested_release_ids": ["extended-release"]},
        )

        execution = client.execute_plan(LidarrPlan((action,)))

        self.assertEqual(execution[0].outcome, "updated")
        payload = client._request.call_args_list[1].kwargs["json"]
        self.assertFalse(payload["anyReleaseOk"])
        self.assertFalse(payload["releases"][0]["monitored"])
        self.assertTrue(payload["releases"][1]["monitored"])

    def test_replaying_plan_does_not_repeat_search(self):
        client = object.__new__(LidarrClient)
        client.config = SimpleNamespace(lidarr_url="http://lidarr")
        monitored = {
            "id": 11,
            "foreignAlbumId": "group",
            "title": "Album",
            "monitored": True,
            "artist": {"foreignArtistId": "artist"},
        }
        client._request = Mock(side_effect=[[monitored], [monitored]])
        plan = LidarrPlan(
            (
                LidarrPlanAction("monitor_release", "artist", "Artist", "group"),
                LidarrPlanAction("queue_search", "artist", "Artist", "group"),
            )
        )

        execution = client.execute_plan(plan)

        self.assertEqual([result.outcome for result in execution], ["unchanged", "unchanged"])
        self.assertTrue(all(call.args[0] == "GET" for call in client._request.call_args_list))

    def test_searches_monitored_release_when_approved_recording_is_still_missing(self):
        client = object.__new__(LidarrClient)
        client.config = SimpleNamespace(lidarr_url="http://lidarr")
        monitored = {
            "id": 11,
            "foreignAlbumId": "group",
            "title": "Album",
            "monitored": True,
            "artist": {"foreignArtistId": "artist"},
        }
        missing_track = {"foreignRecordingId": "missing", "hasFile": False}
        client._request = Mock(side_effect=[[monitored], [missing_track], None])
        plan = LidarrPlan(
            (
                LidarrPlanAction(
                    "queue_search",
                    "artist",
                    "Artist",
                    "group",
                    payload={"requested_recording_ids": ["missing"]},
                ),
            )
        )

        execution = client.execute_plan(plan)

        self.assertEqual(execution[0].outcome, "queued")
        self.assertEqual(client._request.call_args_list[-1].args, ("POST", "command"))

    def test_does_not_search_monitored_release_after_recording_downloads(self):
        client = object.__new__(LidarrClient)
        client.config = SimpleNamespace(lidarr_url="http://lidarr")
        monitored = {
            "id": 11,
            "foreignAlbumId": "group",
            "title": "Album",
            "monitored": True,
            "artist": {"foreignArtistId": "artist"},
        }
        downloaded_track = {"foreignRecordingId": "recording", "hasFile": True}
        client._request = Mock(side_effect=[[monitored], [downloaded_track]])
        plan = LidarrPlan(
            (
                LidarrPlanAction(
                    "queue_search",
                    "artist",
                    "Artist",
                    "group",
                    payload={"requested_recording_ids": ["recording"]},
                ),
            )
        )

        execution = client.execute_plan(plan)

        self.assertEqual(execution[0].outcome, "unchanged")
        self.assertEqual(execution[0].details, "search_precondition_already_satisfied")
        self.assertTrue(all(call.args[0] == "GET" for call in client._request.call_args_list))

    def test_execution_never_runs_an_action_absent_from_plan(self):
        client = object.__new__(LidarrClient)
        client.config = SimpleNamespace(lidarr_url="http://lidarr")
        client._request = Mock()

        execution = client.execute_plan(
            LidarrPlan((LidarrPlanAction("skip", reason="musicbrainz_unresolved"),))
        )

        self.assertEqual(execution[0].outcome, "unchanged")
        client._request.assert_not_called()

    def test_execution_reports_each_action_as_it_completes(self):
        client = object.__new__(LidarrClient)
        client.config = SimpleNamespace(lidarr_url="http://lidarr")
        client._request = Mock()
        updates = []

        client.execute_plan(
            LidarrPlan(
                (
                    LidarrPlanAction("skip", reason="first"),
                    LidarrPlanAction("unchanged", reason="second"),
                )
            ),
            lambda current, total, item: updates.append((current, total, item)),
        )

        self.assertEqual([update[0] for update in updates], [0, 1, 1, 2])
        self.assertTrue(all(update[1] == 2 for update in updates))


if __name__ == "__main__":
    unittest.main()
