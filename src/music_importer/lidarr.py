import logging
import re
import time
import unicodedata
from collections import defaultdict
from collections.abc import Callable
from pathlib import Path

import requests

from .config import Config
from .models import (
    LidarrExecutionResult,
    LidarrPlan,
    LidarrPlanAction,
    MusicBrainzResult,
    Summary,
)

logger = logging.getLogger(__name__)

_VARIOUS_ARTISTS_MBID = "89ad4ac3-39f7-470e-963a-56509c546377"


def _is_various_artists(artist: dict) -> bool:
    return (
        artist.get("foreignArtistId") == _VARIOUS_ARTISTS_MBID
        or (artist.get("artistName") or "").casefold() == "various artists"
    )


def _is_various_artists_album(album: dict) -> bool:
    return _is_various_artists(album.get("artist") or {})


_VERSION_QUALIFIER = re.compile(
    r"\s*[\[(][^\])]*\b(?:edit|mix|remix|version|rework|remaster(?:ed)?|radio|extended|live)\b"
    r"[^\])]*[\])]\s*$",
    re.IGNORECASE,
)


def _comparable_title(value: str) -> str:
    """Normalize a title while ignoring an explicit trailing version qualifier."""
    value = _VERSION_QUALIFIER.sub("", value)
    value = unicodedata.normalize("NFKD", value).casefold()
    return "".join(character for character in value if character.isalnum())


def _downloaded_track_keys(tracks: list[dict]) -> tuple[set[str], set[str]]:
    downloaded = [track for track in tracks if track.get("hasFile")]
    recording_ids = {
        identifier
        for track in downloaded
        for identifier in (track.get("foreignRecordingId"), track.get("foreignTrackId"))
        if identifier
    }
    titles = {_comparable_title(track.get("title") or "") for track in downloaded}
    return recording_ids, titles


def _represented_by_download(
    result: MusicBrainzResult, recording_ids: set[str], titles: set[str]
) -> bool:
    return bool(recording_ids.intersection(result.recording_ids)) or bool(
        result.recording_title and _comparable_title(result.recording_title) in titles
    )


def _downloaded_album_match(
    result: MusicBrainzResult, tracks: list[dict], albums_by_id: dict[int, dict]
) -> tuple[str | None, dict | None, str]:
    downloaded = [track for track in tracks if track.get("hasFile")]
    match = next(
        (
            track
            for track in downloaded
            if {track.get("foreignRecordingId"), track.get("foreignTrackId")}.intersection(
                result.recording_ids
            )
        ),
        None,
    )
    method = "recording_id"
    if match is None and result.recording_title:
        wanted = _comparable_title(result.recording_title)
        match = next(
            (
                track
                for track in downloaded
                if _comparable_title(track.get("title") or "") == wanted
            ),
            None,
        )
        method = "normalized_title"
    album = albums_by_id.get(match.get("albumId")) if match else None
    return (album.get("foreignAlbumId") if album else None, match, method)


def _downloaded_album_group(
    result: MusicBrainzResult, tracks: list[dict], albums_by_id: dict[int, dict]
) -> str | None:
    return _downloaded_album_match(result, tracks, albums_by_id)[0]


def _matched_track_payload(track: dict, match_method: str) -> dict:
    return {
        "id": track.get("id"),
        "title": track.get("title", ""),
        "track_number": track.get("trackNumber") or track.get("absoluteTrackNumber"),
        "foreign_recording_id": track.get("foreignRecordingId") or track.get("foreignTrackId"),
        "track_file_id": track.get("trackFileId"),
        "has_file": bool(track.get("hasFile")),
        "match_method": match_method,
    }


class LidarrClient:
    def __init__(self, config: Config):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({"X-Api-Key": config.lidarr_api_key or ""})

    def _request(self, method: str, path: str, **kwargs):
        attempts = 3 if method.upper() == "GET" else 1
        response = None
        for attempt in range(1, attempts + 1):
            try:
                response = self.session.request(
                    method, f"{self.config.lidarr_url}/api/v1/{path}", timeout=30, **kwargs
                )
                break
            except requests.Timeout as exc:
                if attempt == attempts:
                    raise requests.Timeout(
                        f"Lidarr {method.upper()} /api/v1/{path} timed out after "
                        f"{attempts} attempt{'s' if attempts != 1 else ''}"
                    ) from exc
                logger.warning(
                    "Lidarr %s %s timed out; retrying (%s/%s)", method, path, attempt, attempts
                )
                time.sleep(0.5 * attempt)
        assert response is not None
        try:
            response.raise_for_status()
        except requests.HTTPError:
            logger.error(
                "Lidarr %s %s failed with HTTP %s: %s",
                method,
                path,
                response.status_code,
                response.text,
            )
            raise
        return response.json() if response.content else None

    def _lookup(self, path: str, foreign_id: str, id_field: str) -> dict:
        matches = self._request("GET", path, params={"term": f"lidarr:{foreign_id}"}) or []
        return next((match for match in matches if match.get(id_field) == foreign_id), {})

    def _artist_payload(self, artist_mbid: str, release_groups: set[str]) -> dict:
        payload = self._lookup("artist/lookup", artist_mbid, "foreignArtistId")
        if not payload:
            raise RuntimeError(f"Lidarr could not look up artist {artist_mbid}")
        payload.update(
            {
                "qualityProfileId": self.config.lidarr_quality_profile_id,
                "metadataProfileId": self.config.lidarr_metadata_profile_id,
                "rootFolderPath": self.config.lidarr_root_folder,
                "monitored": False,
                "monitorNewItems": "none",
                "addOptions": {
                    "monitor": "none",
                    "monitored": False,
                    "albumsToMonitor": [],
                    "searchForMissingAlbums": False,
                },
            }
        )
        return payload

    def _add_album(
        self, artist: dict, release_group: str, allow_various_artists: bool = False
    ) -> dict | None:
        payload = self._lookup("album/lookup", release_group, "foreignAlbumId")
        if not payload:
            raise RuntimeError(f"Lidarr could not look up release group {release_group}")
        if _is_various_artists_album(payload) and not allow_various_artists:
            return None
        # Use the local artist resource so Lidarr attaches the album to the existing artist.
        payload.update(
            {
                "artistId": artist["id"],
                "artist": artist,
                "monitored": False,
                "addOptions": {"addType": "manual", "searchForNewAlbum": False},
            }
        )
        return self._request("POST", "album", json=payload) or {}

    def _monitor_artist(self, artist: dict) -> bool:
        if artist.get("monitored") is True and artist.get("monitorNewItems") == "none":
            return False
        artist.update({"monitored": True, "monitorNewItems": "none"})
        self._request("PUT", f"artist/{artist['id']}", json=artist)
        return True

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

        def action_payload(group: str, payload: dict | None = None) -> dict | None:
            values = dict(payload or {})
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
                    if not existing_album or not existing_album.get("monitored"):
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
                    if not album or not album.get("monitored"):
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

    def execute_plan(
        self, plan: LidarrPlan, progress: Callable[[int, int, str], None] | None = None
    ) -> list[LidarrExecutionResult]:
        """Reconcile and execute only the mutations present in an approved plan.

        Every action re-reads its target. A search is queued only when this
        execution actually created/started monitoring its release (or created
        its artist), which makes replaying the same approved plan idempotent.
        """
        results: list[LidarrExecutionResult] = []
        created_artists: set[str] = set()
        changed_releases: set[str] = set()

        def artists() -> dict[str, dict]:
            return {
                item.get("foreignArtistId"): item for item in self._request("GET", "artist") or []
            }

        def album(release_group: str) -> dict | None:
            matches = self._request("GET", "album", params={"foreignAlbumId": release_group}) or []
            return next(
                (item for item in matches if item.get("foreignAlbumId") == release_group), None
            )

        total = len(plan.actions)
        for position, action in enumerate(plan.actions, start=1):
            label = action.artist_name or action.artist_mbid or "Lidarr"
            if action.album_title:
                label += f" — {action.album_title}"
            if progress:
                progress(position - 1, total, f"{action.action.replace('_', ' ').title()}: {label}")
            try:
                if action.action not in {
                    "create_artist",
                    "monitor_artist",
                    "create_release",
                    "monitor_release",
                    "queue_search",
                }:
                    results.append(LidarrExecutionResult(action, "unchanged", action.reason))
                    continue

                if action.action == "create_artist":
                    current = artists().get(action.artist_mbid)
                    if current:
                        results.append(LidarrExecutionResult(action, "unchanged", "artist_exists"))
                        continue
                    groups = set((action.payload or {}).get("release_group_ids") or [])
                    created = (
                        self._request(
                            "POST", "artist", json=self._artist_payload(action.artist_mbid, groups)
                        )
                        or {}
                    )
                    if created.get("id") is None:
                        raise RuntimeError(
                            f"Lidarr did not return created artist {action.artist_mbid}"
                        )
                    created_artists.add(action.artist_mbid)
                    results.append(LidarrExecutionResult(action, "created"))
                    continue

                if action.action == "monitor_artist":
                    current = artists().get(action.artist_mbid)
                    if not current:
                        raise RuntimeError(f"artist is unavailable: {action.artist_mbid}")
                    if not self._monitor_artist(current):
                        results.append(
                            LidarrExecutionResult(action, "unchanged", "already_monitored")
                        )
                    else:
                        results.append(LidarrExecutionResult(action, "updated"))
                    continue

                if action.action == "create_release":
                    allow_va = bool((action.payload or {}).get("allow_various_artists_release"))
                    current_album = album(action.release_group_id)
                    if current_album:
                        if _is_various_artists_album(current_album) and not allow_va:
                            results.append(
                                LidarrExecutionResult(action, "skipped", "various_artists_album")
                            )
                        else:
                            results.append(
                                LidarrExecutionResult(action, "unchanged", "release_exists")
                            )
                        continue
                    current_artist = artists().get(action.artist_mbid)
                    if not current_artist:
                        raise RuntimeError(f"artist is unavailable: {action.artist_mbid}")
                    created = self._add_album(current_artist, action.release_group_id, allow_va)
                    if created is None:
                        results.append(
                            LidarrExecutionResult(action, "skipped", "various_artists_album")
                        )
                    else:
                        changed_releases.add(action.release_group_id)
                        results.append(LidarrExecutionResult(action, "created"))
                    continue

                current_album = album(action.release_group_id)
                if not current_album:
                    raise RuntimeError(f"release is unavailable: {action.release_group_id}")
                if _is_various_artists_album(current_album) and not (action.payload or {}).get(
                    "allow_various_artists_release"
                ):
                    results.append(
                        LidarrExecutionResult(action, "skipped", "various_artists_album")
                    )
                    continue

                if action.action == "monitor_release":
                    if current_album.get("monitored"):
                        results.append(
                            LidarrExecutionResult(action, "unchanged", "already_monitored")
                        )
                    else:
                        self._request(
                            "PUT",
                            "album/monitor",
                            json={"albumIds": [current_album["id"]], "monitored": True},
                        )
                        changed_releases.add(action.release_group_id)
                        results.append(LidarrExecutionResult(action, "updated"))
                    continue

                search_was_enabled = (
                    action.release_group_id in changed_releases
                    or action.artist_mbid in created_artists
                )
                requested_recording_ids = set(
                    (action.payload or {}).get("requested_recording_ids", [])
                )
                if not search_was_enabled and requested_recording_ids:
                    current_tracks = (
                        self._request("GET", "track", params={"albumId": current_album["id"]}) or []
                    )
                    search_was_enabled = not any(
                        track.get("hasFile")
                        and track.get("foreignRecordingId") in requested_recording_ids
                        for track in current_tracks
                    )
                if not search_was_enabled:
                    results.append(
                        LidarrExecutionResult(
                            action, "unchanged", "search_precondition_already_satisfied"
                        )
                    )
                    continue
                self._request(
                    "POST",
                    "command",
                    json={"name": "AlbumSearch", "albumIds": [current_album["id"]]},
                )
                results.append(LidarrExecutionResult(action, "queued"))
            except (requests.RequestException, RuntimeError, KeyError) as exc:
                results.append(LidarrExecutionResult(action, "failed", str(exc)))
            finally:
                if progress:
                    progress(
                        position, total, f"Completed {action.action.replace('_', ' ')}: {label}"
                    )
        return results

    def compare(
        self, results: list[MusicBrainzResult], progress: Callable[[str], None] | None = None
    ) -> tuple[dict[int, str], dict[int, str]]:
        """Return missing and matched result indexes with their classification reasons."""
        existing = {
            artist.get("foreignArtistId"): artist for artist in self._request("GET", "artist") or []
        }
        if progress:
            progress("Loaded Lidarr artists for comparison")
        albums_by_artist: dict[int, dict[str, dict]] = {}
        global_albums_by_group: dict[str, dict | None] = {}
        global_tracks_by_album_id: dict[int, list[dict]] = {}
        files_by_artist: dict[int, tuple[set[str], set[str]]] = {}
        missing: dict[int, str] = {}
        matched: dict[int, str] = {}
        processed_artists: set[str] = set()
        for index, result in enumerate(results):
            if not result.primary_artist_id:
                missing[index] = "musicbrainz_unresolved"
                continue
            if not result.release_group_ids:
                missing[index] = "release_group_unresolved"
                continue
            if result.primary_artist_id == _VARIOUS_ARTISTS_MBID or any(
                name.casefold() == "various artists" for name in result.artist_names
            ):
                missing[index] = "various_artists_skipped"
                continue
            artist = existing.get(result.primary_artist_id)
            if not artist:
                missing[index] = "artist_missing"
                if progress and result.primary_artist_id not in processed_artists:
                    processed_artists.add(result.primary_artist_id)
                    progress(
                        f"Compared {result.artist_names[0] if result.artist_names else result.primary_artist_id}"
                    )
                continue
            artist_id = artist["id"]
            if artist_id not in albums_by_artist:
                albums = self._request("GET", "album", params={"artistId": artist_id}) or []
                albums_by_artist[artist_id] = {
                    album["foreignAlbumId"]: album
                    for album in albums
                    if album.get("foreignAlbumId")
                }
            exact_albums = [
                albums_by_artist[artist_id][release_group]
                for release_group in result.release_group_ids
                if release_group in albums_by_artist[artist_id]
            ]
            if artist_id not in files_by_artist:
                tracks = self._request("GET", "track", params={"artistId": artist_id}) or []
                files_by_artist[artist_id] = _downloaded_track_keys(tracks)
            recording_ids, titles = files_by_artist[artist_id]
            same_recording = bool(recording_ids.intersection(result.recording_ids))
            same_title = bool(
                result.recording_title and _comparable_title(result.recording_title) in titles
            )
            if not same_recording and not same_title and not exact_albums:
                for release_group in result.release_group_ids:
                    if release_group not in global_albums_by_group:
                        matches = (
                            self._request("GET", "album", params={"foreignAlbumId": release_group})
                            or []
                        )
                        global_albums_by_group[release_group] = next(
                            (
                                album
                                for album in matches
                                if album.get("foreignAlbumId") == release_group
                            ),
                            None,
                        )
                    album = global_albums_by_group[release_group]
                    if album is not None:
                        exact_albums.append(album)
                        album_id = album.get("id")
                        if album_id is not None and not _is_various_artists_album(album):
                            if album_id not in global_tracks_by_album_id:
                                global_tracks_by_album_id[album_id] = (
                                    self._request("GET", "track", params={"albumId": album_id})
                                    or []
                                )
                            global_recording_ids, global_titles = _downloaded_track_keys(
                                global_tracks_by_album_id[album_id]
                            )
                            same_recording = bool(
                                global_recording_ids.intersection(result.recording_ids)
                            )
                            same_title = bool(
                                result.recording_title
                                and _comparable_title(result.recording_title) in global_titles
                            )
                            if same_recording or same_title:
                                break
            if same_recording:
                matched[index] = "release_downloaded" if exact_albums else "recording_match"
            elif same_title:
                matched[index] = "alternate_version_title_match"
            elif exact_albums:
                missing[index] = (
                    "release_monitored_missing"
                    if any(album.get("monitored") for album in exact_albums)
                    else "release_unmonitored_missing"
                )
            else:
                missing[index] = "release_missing"
            if progress and result.primary_artist_id not in processed_artists:
                processed_artists.add(result.primary_artist_id)
                progress(
                    f"Compared {result.artist_names[0] if result.artist_names else result.primary_artist_id}"
                )
        return missing, matched

    def downloaded_paths(
        self, results: list[MusicBrainzResult], progress: Callable[[str], None] | None = None
    ) -> dict[int, str]:
        """Return playlist result indexes mapped to downloaded Lidarr file paths."""
        existing = {
            artist.get("foreignArtistId"): artist for artist in self._request("GET", "artist") or []
        }
        if progress:
            progress("Loaded Lidarr artists for file lookup")
        indexes_by_artist: dict[str, list[int]] = defaultdict(list)
        for index, result in enumerate(results):
            if result.primary_artist_id:
                indexes_by_artist[result.primary_artist_id].append(index)

        matched: dict[int, str] = {}
        for artist_mbid, indexes in indexes_by_artist.items():
            artist = existing.get(artist_mbid)
            if not artist:
                if progress:
                    name = results[indexes[0]].artist_names
                    progress(f"Checked files for {name[0] if name else artist_mbid}")
                continue
            artist_id = artist["id"]
            tracks = self._request("GET", "track", params={"artistId": artist_id}) or []
            files = self._request("GET", "trackFile", params={"artistId": artist_id}) or []
            files_by_id = {item.get("id"): item for item in files if item.get("id") is not None}

            candidates = []
            for track in tracks:
                if not track.get("hasFile"):
                    continue
                track_file = (
                    track.get("trackFile") or files_by_id.get(track.get("trackFileId")) or {}
                )
                path = track_file.get("path")
                if not path and track_file.get("relativePath") and artist.get("path"):
                    path = str(Path(artist["path"]) / track_file["relativePath"])
                if path:
                    candidates.append((track, path))

            for index in indexes:
                result = results[index]
                exact = next(
                    (
                        path
                        for track, path in candidates
                        if {
                            track.get("foreignRecordingId"),
                            track.get("foreignTrackId"),
                        }.intersection(result.recording_ids)
                    ),
                    None,
                )
                if exact:
                    matched[index] = exact
                    continue
                wanted_title = _comparable_title(result.recording_title)
                title_match = next(
                    (
                        path
                        for track, path in candidates
                        if wanted_title
                        and _comparable_title(track.get("title") or "") == wanted_title
                    ),
                    None,
                )
                if title_match:
                    matched[index] = title_match
            if progress:
                name = results[indexes[0]].artist_names
                progress(f"Checked files for {name[0] if name else artist_mbid}")

        albums_by_group: dict[str, dict | None] = {}
        tracks_by_album_id: dict[int, list[dict]] = {}
        files_by_artist_id: dict[int, dict[int, dict]] = {}
        for index, result in enumerate(results):
            if index in matched:
                continue
            for group in result.release_group_ids:
                if group not in albums_by_group:
                    albums = self._request("GET", "album", params={"foreignAlbumId": group}) or []
                    albums_by_group[group] = next(
                        (album for album in albums if album.get("foreignAlbumId") == group), None
                    )
                album = albums_by_group[group]
                if album is None or _is_various_artists_album(album):
                    continue
                album_id = album.get("id")
                artist_id = album.get("artistId") or (album.get("artist") or {}).get("id")
                if album_id is None or artist_id is None:
                    continue
                if album_id not in tracks_by_album_id:
                    tracks_by_album_id[album_id] = (
                        self._request("GET", "track", params={"albumId": album_id}) or []
                    )
                if artist_id not in files_by_artist_id:
                    files = self._request("GET", "trackFile", params={"artistId": artist_id}) or []
                    files_by_artist_id[artist_id] = {
                        item["id"]: item for item in files if item.get("id") is not None
                    }
                candidates = []
                artist_path = (album.get("artist") or {}).get("path")
                for track in tracks_by_album_id[album_id]:
                    if not track.get("hasFile"):
                        continue
                    track_file = files_by_artist_id[artist_id].get(track.get("trackFileId")) or {}
                    path = track_file.get("path")
                    if not path and track_file.get("relativePath") and artist_path:
                        path = str(Path(artist_path) / track_file["relativePath"])
                    if path:
                        candidates.append((track, path))
                exact = next(
                    (
                        path
                        for track, path in candidates
                        if {
                            track.get("foreignRecordingId"),
                            track.get("foreignTrackId"),
                        }.intersection(result.recording_ids)
                    ),
                    None,
                )
                if exact:
                    matched[index] = exact
                    break
                wanted_title = _comparable_title(result.recording_title)
                title_match = next(
                    (
                        path
                        for track, path in candidates
                        if wanted_title
                        and _comparable_title(track.get("title") or "") == wanted_title
                    ),
                    None,
                )
                if title_match:
                    matched[index] = title_match
                    break
        return matched

    def sync_planned(
        self, results: list[MusicBrainzResult], summary: Summary
    ) -> list[dict[str, str]]:
        """Compatibility facade over the same plan/execute APIs used by the GUI."""
        plan = self.plan(results)
        execution = self.execute_plan(plan)
        created_artists = {
            item.action.artist_mbid
            for item in execution
            if item.action.action == "create_artist" and item.outcome == "created"
        }
        updated_artists = {
            item.action.artist_mbid
            for item in execution
            if item.action.action in {"monitor_artist", "monitor_release"}
            and item.outcome == "updated"
        } - created_artists
        represented_artists = {action.artist_mbid for action in plan.actions if action.artist_mbid}
        failed_artists = {item.action.artist_mbid for item in execution if item.outcome == "failed"}
        summary.lidarr_added += len(created_artists)
        summary.lidarr_updated += len(updated_artists)
        summary.lidarr_skipped += len(
            (represented_artists - created_artists - updated_artists) | failed_artists
        )
        configured_url = (self.config.lidarr_url or "").rstrip("/")
        action_names = {
            "create_artist": "add_artist",
            "create_release": "add_album",
            "monitor_release": "monitor_album",
            "queue_search": "search_album",
            "reuse_downloaded_release": "consolidate_release",
        }
        return [
            {
                "mapped_artist_names": item.action.artist_name,
                "artist_name": item.action.artist_name,
                "artist_mbid": item.action.artist_mbid,
                "artist_lidarr_url": (
                    f"{configured_url}/artist/{item.action.artist_mbid}"
                    if configured_url and item.action.artist_mbid
                    else ""
                ),
                "release_group_id": item.action.release_group_id,
                "album_title": item.action.album_title,
                "album_lidarr_url": (
                    f"{configured_url}/album/{item.action.release_group_id}"
                    if configured_url and item.action.release_group_id
                    else ""
                ),
                "action": action_names.get(item.action.action, item.action.action),
                "outcome": item.outcome,
                "details": item.details or item.action.reason,
            }
            for item in execution
        ]

    def sync(self, results: list[MusicBrainzResult], summary: Summary) -> list[dict[str, str]]:
        """Previous implementation retained briefly as a refactor reference."""
        actions: list[dict[str, str]] = []

        def record(
            artist_mbid: str,
            artist_name: str,
            action: str,
            outcome: str,
            *,
            album: dict | None = None,
            release_group: str = "",
            mapped_artist_names: str = "",
            details: str = "",
        ) -> None:
            release_group_id = release_group or (album or {}).get("foreignAlbumId", "")
            configured_url = getattr(self.config, "lidarr_url", "")
            base_url = configured_url.rstrip("/") if isinstance(configured_url, str) else ""
            actions.append(
                {
                    "mapped_artist_names": mapped_artist_names,
                    "artist_name": artist_name,
                    "artist_mbid": artist_mbid,
                    "artist_lidarr_url": f"{base_url}/artist/{artist_mbid}" if artist_mbid else "",
                    "release_group_id": release_group_id,
                    "album_title": (album or {}).get("title", ""),
                    "album_lidarr_url": (
                        f"{base_url}/album/{release_group_id}" if release_group_id else ""
                    ),
                    "action": action,
                    "outcome": outcome,
                    "details": details,
                }
            )

        grouped_results: dict[str, list[MusicBrainzResult]] = defaultdict(list)
        for result in results:
            is_various_artists = result.primary_artist_id == _VARIOUS_ARTISTS_MBID or any(
                name.casefold() == "various artists" for name in result.artist_names
            )
            if is_various_artists and result.release_group_ids:
                record(
                    result.primary_artist_id or "",
                    "Various Artists",
                    "skip_artist",
                    "skipped",
                    details="Various Artists is excluded",
                )
            if result.primary_artist_id and result.release_group_ids and not is_various_artists:
                grouped_results[result.primary_artist_id].append(result)
        try:
            existing = {
                artist.get("foreignArtistId"): artist
                for artist in self._request("GET", "artist") or []
            }
        except requests.RequestException as exc:
            logger.error("Could not read artists from Lidarr: %s", exc)
            summary.lidarr_skipped += len(grouped_results)
            record("", "", "read_artists", "failed", details=str(exc))
            return actions
        # Albums are globally unique in Lidarr. A release group from a compilation
        # can already exist under an album artist other than the track's primary artist.
        known_albums: dict[str, dict] = {}
        for artist_mbid, artist_results in grouped_results.items():
            try:
                artist = existing.get(artist_mbid)
                artist_was_added = artist is None
                mapped_artist_names = "; ".join(
                    dict.fromkeys(name for result in artist_results for name in result.artist_names)
                )
                mapped_release_groups = {
                    release_group
                    for result in artist_results
                    for release_group in result.release_group_ids
                }
                if artist_was_added:
                    artist = (
                        self._request(
                            "POST",
                            "artist",
                            json=self._artist_payload(artist_mbid, mapped_release_groups),
                        )
                        or {}
                    )
                    if artist.get("id") is None:
                        raise RuntimeError(
                            f"Lidarr did not return the created artist {artist_mbid}"
                        )
                    summary.lidarr_added += 1
                artist_name = artist.get("artistName") or artist_mbid
                if artist_was_added:
                    record(
                        artist_mbid,
                        artist_name,
                        "add_artist",
                        "created",
                        mapped_artist_names=mapped_artist_names,
                    )
                tracks = self._request("GET", "track", params={"artistId": artist["id"]}) or []
                recording_ids, titles = _downloaded_track_keys(tracks)
                albums = self._request("GET", "album", params={"artistId": artist["id"]}) or []
                albums_by_mbid = {album.get("foreignAlbumId"): album for album in albums}
                albums_by_id = {
                    album["id"]: album for album in albums if album.get("id") is not None
                }
                requested_release_groups: set[str] = set()
                search_release_groups: set[str] = set()
                consolidated: list[tuple[MusicBrainzResult, str]] = []
                for result in artist_results:
                    downloaded_group = _downloaded_album_group(result, tracks, albums_by_id)
                    if downloaded_group:
                        requested_release_groups.add(downloaded_group)
                        if downloaded_group not in result.release_group_ids:
                            consolidated.append((result, downloaded_group))
                    else:
                        requested_release_groups.update(result.release_group_ids)
                        if not _represented_by_download(result, recording_ids, titles):
                            search_release_groups.update(result.release_group_ids)
                logger.info(
                    "Adding songs for %s (%d requested release%s)",
                    artist_name,
                    len(requested_release_groups),
                    "" if len(requested_release_groups) == 1 else "s",
                )
                for result, downloaded_group in consolidated:
                    record(
                        artist_mbid,
                        artist_name,
                        "consolidate_release",
                        "reused",
                        release_group=downloaded_group,
                        mapped_artist_names=mapped_artist_names,
                        details=(
                            "downloaded recording already belongs to this Lidarr album; "
                            f"mapped candidates: {', '.join(result.release_group_ids)}"
                        ),
                    )
                known_albums.update(albums_by_mbid)
                for release_group in sorted(requested_release_groups - albums_by_mbid.keys()):
                    album = known_albums.get(release_group)
                    if album is None:
                        matches = (
                            self._request("GET", "album", params={"foreignAlbumId": release_group})
                            or []
                        )
                        album = next(
                            (
                                item
                                for item in matches
                                if item.get("foreignAlbumId") == release_group
                            ),
                            None,
                        )
                    if album is not None and _is_various_artists_album(album):
                        record(
                            artist_mbid,
                            artist_name,
                            "skip_album",
                            "skipped",
                            album=album,
                            release_group=release_group,
                            mapped_artist_names=mapped_artist_names,
                            details="release group belongs to Various Artists",
                        )
                        continue
                    if album is None:
                        album = self._add_album(artist, release_group)
                        if album is None:
                            record(
                                artist_mbid,
                                artist_name,
                                "skip_album",
                                "skipped",
                                release_group=release_group,
                                mapped_artist_names=mapped_artist_names,
                                details="album lookup belongs to Various Artists",
                            )
                            continue
                        record(
                            artist_mbid,
                            artist_name,
                            "add_album",
                            "created",
                            album=album,
                            release_group=release_group,
                            mapped_artist_names=mapped_artist_names,
                        )
                    if album.get("id") is not None:
                        known_albums[release_group] = album
                        albums_by_mbid[release_group] = album
                selected = [
                    albums_by_mbid[release_group]
                    for release_group in sorted(requested_release_groups)
                    if release_group in albums_by_mbid
                    and not albums_by_mbid[release_group].get("monitored")
                ]
                if selected:
                    logger.info(
                        "Monitoring for %s: %s",
                        artist_name,
                        ", ".join(
                            album.get("title") or album["foreignAlbumId"] for album in selected
                        ),
                    )
                    for album in selected:
                        album["monitored"] = True
                    self._request(
                        "PUT",
                        "album/monitor",
                        json={"albumIds": [a["id"] for a in selected], "monitored": True},
                    )
                    for album in selected:
                        record(
                            artist_mbid,
                            artist_name,
                            "monitor_album",
                            "updated",
                            album=album,
                            mapped_artist_names=mapped_artist_names,
                        )
                requested = [
                    albums_by_mbid[release_group]
                    for release_group in sorted(requested_release_groups)
                    if release_group in albums_by_mbid
                ]
                to_search = [
                    album
                    for album in (requested if artist_was_added else selected)
                    if album.get("foreignAlbumId") in search_release_groups
                ]
                if to_search:
                    logger.info(
                        "Searching for %s: %s",
                        artist_name,
                        ", ".join(
                            album.get("title") or album["foreignAlbumId"] for album in to_search
                        ),
                    )
                    self._request(
                        "POST",
                        "command",
                        json={
                            "name": "AlbumSearch",
                            "albumIds": [album["id"] for album in to_search],
                        },
                    )
                    for album in to_search:
                        record(
                            artist_mbid,
                            artist_name,
                            "search_album",
                            "queued",
                            album=album,
                            mapped_artist_names=mapped_artist_names,
                        )
                artist_changed = self._monitor_artist(artist)
                if artist_changed:
                    record(
                        artist_mbid,
                        artist_name,
                        "monitor_artist",
                        "updated",
                        mapped_artist_names=mapped_artist_names,
                        details="monitored=true; monitorNewItems=none",
                    )
                if not artist_was_added:
                    if selected:
                        summary.lidarr_updated += 1
                    else:
                        summary.lidarr_skipped += 1
                if not any(action["artist_mbid"] == artist_mbid for action in actions):
                    record(
                        artist_mbid,
                        artist_name,
                        "reconcile_artist",
                        "unchanged",
                        mapped_artist_names=mapped_artist_names,
                    )
            except (requests.RequestException, RuntimeError) as exc:
                logger.error("Lidarr operation failed for artist %s: %s", artist_mbid, exc)
                summary.lidarr_skipped += 1
                record(
                    artist_mbid,
                    (artist or {}).get("artistName") or artist_mbid,
                    "reconcile_artist",
                    "failed",
                    details=str(exc),
                )
        return actions
