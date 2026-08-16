import unittest
from unittest.mock import Mock, call

from music_importer.application.acquisition import PlaylistService
from music_importer.application.playlist_export import PlaylistExportService
from music_importer.application.resolution import ResolutionService
from music_importer.domain.models import MusicBrainzResult, PlaylistInfo, SourceTrack


class PlaylistServiceTests(unittest.TestCase):
    def test_delegates_source_operations_without_terminal_or_report_side_effects(self):
        source = Mock()
        playlist = PlaylistInfo("spotify", "id", "Mix")
        tracks = [SourceTrack("spotify", "track", "Song", ("Artist",), "Album")]
        source.list_playlists.return_value = [playlist]
        source.get_playlist.return_value = playlist
        source.get_tracks.return_value = tracks
        service = PlaylistService(source)

        service.authenticate()

        self.assertEqual(service.list_playlists(), [playlist])
        self.assertEqual(service.get_playlist("id"), playlist)
        self.assertEqual(service.get_tracks(playlist), tracks)
        source.login.assert_called_once_with()


class ResolutionServiceTests(unittest.TestCase):
    def test_preserves_order_duplicates_summary_and_structured_progress(self):
        tracks = [
            SourceTrack("spotify", "same", "First", ("Artist",), "Album"),
            SourceTrack("spotify", "other", "Missing", ("Artist",), "Album"),
            SourceTrack("spotify", "same", "First", ("Artist",), "Album"),
        ]
        resolver = Mock()
        resolver.resolve.side_effect = [
            MusicBrainzResult(resolved_via="isrc"),
            MusicBrainzResult(),
            MusicBrainzResult(resolved_via="search"),
        ]
        progress = Mock()

        batch = ResolutionService(resolver).resolve_tracks(tracks, progress)

        self.assertEqual(batch.tracks, tracks)
        self.assertEqual(
            (
                batch.summary.total,
                batch.summary.resolved_by_isrc,
                batch.summary.resolved_by_search,
                batch.summary.unresolved,
            ),
            (3, 1, 1, 1),
        )
        self.assertEqual(
            resolver.resolve.call_args_list, [call(tracks[0]), call(tracks[1]), call(tracks[2])]
        )
        self.assertEqual([item.args[0].current for item in progress.call_args_list], [1, 2, 3])


class PlaylistExportServiceTests(unittest.TestCase):
    def test_builds_downloaded_tracks_in_original_order_and_skips_missing_paths(self):
        tracks = [
            SourceTrack("spotify", "same", "Song", ("Artist",), "Album"),
            SourceTrack("spotify", "fallback", "Other", ("Artist",), "Album"),
            SourceTrack("spotify", "same", "Song", ("Artist",), "Album"),
        ]
        results = [MusicBrainzResult(resolved_via="isrc") for _ in tracks]
        library = Mock()
        library.downloaded_paths.return_value = {
            0: "/music/Song.flac",
            2: "/music/Song.flac",
        }
        export = PlaylistExportService(library).build(tracks, results, [("/music", "/media/music")])

        self.assertEqual([entry.position for entry in export.entries], [0, 2])
        self.assertEqual(
            [entry.path for entry in export.entries],
            [
                "/media/music/Song.flac",
                "/media/music/Song.flac",
            ],
        )
        self.assertEqual([item.position for item in export.missing], [1])
        self.assertEqual(export.missing[0].reason, "not_downloaded_or_unmatched")

    def test_rejects_misaligned_tracks_and_results(self):
        with self.assertRaisesRegex(ValueError, "equal length"):
            PlaylistExportService(Mock()).build([], [MusicBrainzResult()], [])


if __name__ == "__main__":
    unittest.main()
