import logging
from collections.abc import Callable

import requests

from ...domain.models import (
    LidarrExecutionResult,
    LidarrPlan,
)
from .matching import (
    _is_various_artists_album,
)

logger = logging.getLogger("music_importer.integrations.lidarr.client")


class ExecutionClient:
    def execute_plan(
        self, plan: LidarrPlan, progress: Callable[[int, int, str], None] | None = None
    ) -> list[LidarrExecutionResult]:
        """Reconcile and execute only the mutations present in an approved plan.

        Every target is re-read once for this execution. Mutations update the
        execution-local snapshot before dependent actions run. A search is queued
        only when this execution actually created/started monitoring its release
        (or created its artist), which makes replaying the same approved plan
        idempotent without repeating identical Lidarr reads for adjacent actions.
        """
        results: list[LidarrExecutionResult] = []
        created_artists: set[str] = set()
        changed_releases: set[str] = set()
        known_artists: dict[str, dict] | None = None
        known_albums: dict[str, dict | None] = {}

        def artists() -> dict[str, dict]:
            nonlocal known_artists
            if known_artists is None:
                known_artists = {
                    item.get("foreignArtistId"): item
                    for item in self._request("GET", "artist") or []
                }
            return known_artists

        def album(release_group: str) -> dict | None:
            if release_group not in known_albums:
                matches = (
                    self._request("GET", "album", params={"foreignAlbumId": release_group}) or []
                )
                known_albums[release_group] = next(
                    (item for item in matches if item.get("foreignAlbumId") == release_group),
                    None,
                )
            return known_albums[release_group]

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
                    artists()[action.artist_mbid] = created
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
                        artists()[action.artist_mbid] = current
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
                    requested_release_ids = set(
                        (action.payload or {}).get("requested_release_ids", [])
                    )
                    created = self._add_album(
                        current_artist,
                        action.release_group_id,
                        allow_va,
                        requested_release_ids,
                    )
                    if created is None:
                        results.append(
                            LidarrExecutionResult(action, "skipped", "various_artists_album")
                        )
                    else:
                        changed_releases.add(action.release_group_id)
                        known_albums[action.release_group_id] = created
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
                    requested_release_ids = set(
                        (action.payload or {}).get("requested_release_ids", [])
                    )
                    release_changed = self._pin_selected_release(
                        current_album, requested_release_ids
                    )
                    monitoring_changed = not current_album.get("monitored")
                    if not monitoring_changed and not release_changed:
                        results.append(
                            LidarrExecutionResult(
                                action, "unchanged", "already_monitored_and_release_selected"
                            )
                        )
                    else:
                        current_album["monitored"] = True
                        self._request("PUT", f"album/{current_album['id']}", json=current_album)
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
