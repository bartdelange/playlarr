import logging
from collections import defaultdict
from collections.abc import Callable

from ...domain.models import (
    LidarrPlan,
    LidarrPlanAction,
    MusicBrainzResult,
)
from .matching import (
    _VARIOUS_ARTISTS_MBID,
    _downloaded_album_match,
    _downloaded_track_keys,
    _is_various_artists_album,
    _matched_track_payload,
    _represented_by_download,
)

logger = logging.getLogger("music_importer.integrations.lidarr.client")


class PlanningClient:
    def missing(self, results: list[MusicBrainzResult]) -> dict[int, str]:
        """Return result indexes that are not represented in Lidarr and why."""
        missing, _ = self.compare(results)
        return missing

    def plan(
        self,
        results: list[MusicBrainzResult],
        progress: Callable[[int, int, str], None] | None = None,
        allow_various_artists_recordings: set[str] | None = None,
    ) -> LidarrPlan:
        """Inspect Lidarr and describe reconciliation without mutating it.

        Planning intentionally emits domain actions rather than replayable HTTP
        requests. Execution must re-read relevant resources before applying them.
        """
        actions: list[LidarrPlanAction] = []
        allow_various_artists_recordings = allow_various_artists_recordings or set()
        override_groups = {
            group
            for result in results
            if set(result.recording_ids).intersection(allow_various_artists_recordings)
            for group in result.release_group_ids
        }
        requested_release_ids_by_group: dict[str, set[str]] = defaultdict(set)
        for result in results:
            for group in result.release_group_ids:
                requested_release_ids_by_group[group].update(result.release_ids)

        def action_payload(group: str, payload: dict | None = None) -> dict | None:
            values = dict(payload or {})
            if requested_release_ids_by_group[group]:
                values["requested_release_ids"] = sorted(requested_release_ids_by_group[group])
            if group in override_groups:
                values["allow_various_artists_release"] = True
            return values or None

        grouped: dict[str, list[MusicBrainzResult]] = defaultdict(list)
        for result in results:
            if not result.primary_artist_id:
                actions.append(LidarrPlanAction("skip", reason="musicbrainz_unresolved"))
                continue
            if not result.release_group_ids:
                actions.append(
                    LidarrPlanAction(
                        "skip",
                        artist_mbid=result.primary_artist_id,
                        artist_name=result.artist_names[0] if result.artist_names else "",
                        reason="release_group_unresolved",
                    )
                )
                continue
            if result.primary_artist_id == _VARIOUS_ARTISTS_MBID or any(
                name.casefold() == "various artists" for name in result.artist_names
            ):
                actions.append(
                    LidarrPlanAction(
                        "skip",
                        artist_mbid=result.primary_artist_id,
                        artist_name="Various Artists",
                        reason="various_artists_skipped",
                    )
                )
                continue
            grouped[result.primary_artist_id].append(result)

        total = len(grouped) + 1
        if progress:
            progress(0, total, "Loading artists from Lidarr")
        existing = {
            artist.get("foreignArtistId"): artist for artist in self._request("GET", "artist") or []
        }
        if progress:
            progress(1, total, "Loaded Lidarr artists")
        known_global_albums: dict[str, dict] = {}
        globally_checked_groups: set[str] = set()
        tracks_by_album_id: dict[int, list[dict]] = {}

        def global_album(group: str) -> dict | None:
            if group not in globally_checked_groups:
                matches = self._request("GET", "album", params={"foreignAlbumId": group}) or []
                album = next(
                    (item for item in matches if item.get("foreignAlbumId") == group), None
                )
                if album is not None:
                    known_global_albums[group] = album
                globally_checked_groups.add(group)
            return known_global_albums.get(group)

        def global_downloaded_match(
            result: MusicBrainzResult, local_groups: set[str]
        ) -> tuple[dict, dict, str] | None:
            for group in result.release_group_ids:
                if group in local_groups:
                    continue
                album = global_album(group)
                if album is None or (
                    _is_various_artists_album(album) and group not in override_groups
                ):
                    continue
                album_id = album.get("id")
                if album_id is None:
                    continue
                if album_id not in tracks_by_album_id:
                    tracks_by_album_id[album_id] = (
                        self._request("GET", "track", params={"albumId": album_id}) or []
                    )
                matched_group, track, method = _downloaded_album_match(
                    result, tracks_by_album_id[album_id], {album_id: album}
                )
                if matched_group and track:
                    return album, track, method
            return None

        for artist_number, (artist_mbid, artist_results) in enumerate(grouped.items(), start=1):
            artist = existing.get(artist_mbid)
            artist_name = next(
                (name for result in artist_results for name in result.artist_names), artist_mbid
            )
            if progress:
                progress(artist_number, total, f"Inspecting {artist_name}")
            requested_groups = {
                group for result in artist_results for group in result.release_group_ids
            }
            if artist is None:
                actions.append(
                    LidarrPlanAction(
                        "create_artist",
                        artist_mbid,
                        artist_name,
                        reason="artist_missing",
                        payload={"release_group_ids": sorted(requested_groups)},
                    )
                )
                for group in sorted(requested_groups):
                    matches = self._request("GET", "album", params={"foreignAlbumId": group}) or []
                    existing_album = next(
                        (item for item in matches if item.get("foreignAlbumId") == group), None
                    )
                    lookup = existing_album or self._lookup("album/lookup", group, "foreignAlbumId")
                    if (
                        lookup
                        and _is_various_artists_album(lookup)
                        and group not in override_groups
                    ):
                        actions.append(
                            LidarrPlanAction(
                                "skip",
                                artist_mbid,
                                artist_name,
                                group,
                                lookup.get("title", ""),
                                "various_artists_album",
                            )
                        )
                        continue
                    if existing_album:
                        actions.append(
                            LidarrPlanAction(
                                "reuse_existing_release",
                                artist_mbid,
                                artist_name,
                                group,
                                existing_album.get("title", ""),
                                "release_exists_globally",
                            )
                        )
                    else:
                        actions.append(
                            LidarrPlanAction(
                                "create_release",
                                artist_mbid,
                                artist_name,
                                group,
                                lookup.get("title", "") if lookup else "",
                                "release_missing",
                                action_payload(group),
                            )
                        )
                    release_needs_pinning = bool(
                        existing_album
                        and requested_release_ids_by_group[group]
                        and self._pin_selected_release(
                            {
                                **existing_album,
                                "releases": [dict(r) for r in existing_album.get("releases") or []],
                            },
                            requested_release_ids_by_group[group],
                        )
                    )
                    if (
                        not existing_album
                        or not existing_album.get("monitored")
                        or release_needs_pinning
                    ):
                        actions.append(
                            LidarrPlanAction(
                                "monitor_release",
                                artist_mbid,
                                artist_name,
                                group,
                                lookup.get("title", "") if lookup else "",
                                "requested_release",
                                action_payload(group),
                            )
                        )
                    actions.append(
                        LidarrPlanAction(
                            "queue_search",
                            artist_mbid,
                            artist_name,
                            group,
                            lookup.get("title", "") if lookup else "",
                            "requested_track_missing",
                            action_payload(group),
                        )
                    )
                actions.append(
                    LidarrPlanAction(
                        "monitor_artist",
                        artist_mbid,
                        artist_name,
                        reason="monitored_with_new_items_disabled",
                    )
                )
                continue

            artist_name = artist.get("artistName") or artist_name
            tracks = self._request("GET", "track", params={"artistId": artist["id"]}) or []
            albums = self._request("GET", "album", params={"artistId": artist["id"]}) or []
            albums_by_group = {
                album.get("foreignAlbumId"): album
                for album in albums
                if album.get("foreignAlbumId")
            }
            albums_by_id = {album["id"]: album for album in albums if album.get("id") is not None}
            recording_ids, titles = _downloaded_track_keys(tracks)
            effective_groups: set[str] = set()
            groups_needing_search: set[str] = set()
            missing_recordings_by_group: dict[str, set[str]] = defaultdict(set)
            for result in artist_results:
                downloaded_group, matched_track, match_method = _downloaded_album_match(
                    result, tracks, albums_by_id
                )
                global_match = (
                    None
                    if downloaded_group
                    else global_downloaded_match(result, set(albums_by_group))
                )
                if global_match:
                    matched_album, matched_track, match_method = global_match
                    downloaded_group = matched_album["foreignAlbumId"]
                if downloaded_group:
                    effective_groups.add(downloaded_group)
                    if downloaded_group not in result.release_group_ids:
                        actions.append(
                            LidarrPlanAction(
                                "reuse_downloaded_release",
                                artist_mbid,
                                artist_name,
                                downloaded_group,
                                albums_by_group.get(downloaded_group, {}).get("title", ""),
                                "downloaded_recording_match",
                                {
                                    "mapped_release_group_ids": list(result.release_group_ids),
                                    "lidarr_album_id": (
                                        albums_by_group.get(downloaded_group)
                                        or known_global_albums.get(downloaded_group)
                                        or {}
                                    ).get("id"),
                                    "requested_recording_ids": list(result.recording_ids),
                                    "matched_track": _matched_track_payload(
                                        matched_track or {}, match_method
                                    ),
                                },
                            )
                        )
                    else:
                        actions.append(
                            LidarrPlanAction(
                                "unchanged",
                                artist_mbid,
                                artist_name,
                                downloaded_group,
                                (
                                    albums_by_group.get(downloaded_group)
                                    or known_global_albums.get(downloaded_group)
                                    or {}
                                ).get("title", ""),
                                "requested_recording_downloaded",
                                {
                                    "lidarr_album_id": (
                                        albums_by_group.get(downloaded_group)
                                        or known_global_albums.get(downloaded_group)
                                        or {}
                                    ).get("id"),
                                    "requested_recording_ids": list(result.recording_ids),
                                    "matched_track": _matched_track_payload(
                                        matched_track or {}, match_method
                                    ),
                                },
                            )
                        )
                else:
                    effective_groups.update(result.release_group_ids)
                    if not _represented_by_download(result, recording_ids, titles):
                        groups_needing_search.update(result.release_group_ids)
                        for group in result.release_group_ids:
                            missing_recordings_by_group[group].update(result.recording_ids)

            known_global_albums.update(albums_by_group)
            for group in sorted(effective_groups):
                album = albums_by_group.get(group) or known_global_albums.get(group)
                if album is None:
                    album = global_album(group)
                if (
                    album is not None
                    and _is_various_artists_album(album)
                    and group not in override_groups
                ):
                    actions.append(
                        LidarrPlanAction(
                            "skip",
                            artist_mbid,
                            artist_name,
                            group,
                            album.get("title", ""),
                            "various_artists_album",
                        )
                    )
                    continue
                if album is None:
                    lookup = self._lookup("album/lookup", group, "foreignAlbumId")
                    if (
                        lookup
                        and _is_various_artists_album(lookup)
                        and group not in override_groups
                    ):
                        actions.append(
                            LidarrPlanAction(
                                "skip",
                                artist_mbid,
                                artist_name,
                                group,
                                lookup.get("title", ""),
                                "various_artists_album",
                            )
                        )
                        continue
                    actions.append(
                        LidarrPlanAction(
                            "create_release",
                            artist_mbid,
                            artist_name,
                            group,
                            lookup.get("title", "") if lookup else "",
                            "release_missing",
                            action_payload(group),
                        )
                    )
                    album = lookup
                if group in groups_needing_search:
                    release_needs_pinning = bool(
                        album
                        and requested_release_ids_by_group[group]
                        and self._pin_selected_release(
                            {**album, "releases": [dict(r) for r in album.get("releases") or []]},
                            requested_release_ids_by_group[group],
                        )
                    )
                    if not album or not album.get("monitored") or release_needs_pinning:
                        actions.append(
                            LidarrPlanAction(
                                "monitor_release",
                                artist_mbid,
                                artist_name,
                                group,
                                (album or {}).get("title", ""),
                                "requested_track_missing",
                                action_payload(
                                    group,
                                    {
                                        "requested_recording_ids": sorted(
                                            missing_recordings_by_group[group]
                                        )
                                    },
                                ),
                            )
                        )
                    else:
                        actions.append(
                            LidarrPlanAction(
                                "unchanged",
                                artist_mbid,
                                artist_name,
                                group,
                                album.get("title", ""),
                                "already_monitored",
                            )
                        )
                    actions.append(
                        LidarrPlanAction(
                            "queue_search",
                            artist_mbid,
                            artist_name,
                            group,
                            (album or {}).get("title", ""),
                            "requested_track_missing",
                            action_payload(
                                group,
                                {
                                    "requested_recording_ids": sorted(
                                        missing_recordings_by_group[group]
                                    )
                                },
                            ),
                        )
                    )
                else:
                    if not any(
                        action.artist_mbid == artist_mbid and action.release_group_id == group
                        for action in actions
                    ):
                        actions.append(
                            LidarrPlanAction(
                                "unchanged",
                                artist_mbid,
                                artist_name,
                                group,
                                album.get("title", ""),
                                "requested_recording_downloaded",
                            )
                        )
            needs_acquisition = any(
                action.artist_mbid == artist_mbid
                and action.action in {"create_release", "monitor_release", "queue_search"}
                for action in actions
            )
            if needs_acquisition and (
                not artist.get("monitored") or artist.get("monitorNewItems") != "none"
            ):
                actions.append(
                    LidarrPlanAction(
                        "monitor_artist",
                        artist_mbid,
                        artist_name,
                        reason="monitored_with_new_items_disabled",
                    )
                )
            if not any(
                action.artist_mbid == artist_mbid and action.action != "unchanged"
                for action in actions
            ):
                actions.append(
                    LidarrPlanAction(
                        "unchanged", artist_mbid, artist_name, reason="already_reconciled"
                    )
                )
        if progress:
            progress(total, total, "Lidarr plan ready")
        return LidarrPlan(tuple(actions))
