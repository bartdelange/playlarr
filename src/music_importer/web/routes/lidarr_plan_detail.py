from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse

from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    render = ui.render

    @app.get("/plans/{plan_id}", response_class=HTMLResponse)
    def plan_detail(request: Request, plan_id: str):
        try:
            import_id, status, plan = repository.get_lidarr_plan(plan_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        artist_ids = {action.artist_mbid for action in plan.actions if action.artist_mbid}
        release_ids = {
            action.release_group_id for action in plan.actions if action.release_group_id
        }
        summary = {
            "artists": len(artist_ids),
            "new_artists": sum(action.action == "create_artist" for action in plan.actions),
            "releases": len(release_ids),
            "represented": sum(
                action.action in {"reuse_downloaded_release", "reuse_existing_release", "unchanged"}
                for action in plan.actions
            ),
            "monitored": sum(action.action == "monitor_release" for action in plan.actions),
            "searches": sum(action.action == "queue_search" for action in plan.actions),
            "attention": sum(action.action == "skip" for action in plan.actions),
        }
        imported = repository.get_import(import_id)
        entries = repository.entries(import_id)
        actions_by_group: dict[str, list] = {}
        actions_by_artist: dict[str, list] = {}
        reuse_by_source_group: dict[str, list] = {}
        for action in plan.actions:
            if action.release_group_id:
                actions_by_group.setdefault(action.release_group_id, []).append(action)
            elif action.artist_mbid:
                actions_by_artist.setdefault(action.artist_mbid, []).append(action)
            if action.action == "reuse_downloaded_release":
                for original in (action.payload or {}).get("mapped_release_group_ids", []):
                    reuse_by_source_group.setdefault(original, []).append(action)
        track_links = []
        mutating_action_names = {
            "create_artist",
            "create_release",
            "monitor_artist",
            "monitor_release",
            "queue_search",
        }
        for entry in entries:
            releases = []
            for original_group in entry.result.release_group_ids:
                reuse_action = next(
                    (
                        action
                        for action in reuse_by_source_group.get(original_group, [])
                        if set(
                            (action.payload or {}).get("requested_recording_ids", [])
                        ).intersection(entry.result.recording_ids)
                    ),
                    None,
                )
                lidarr_group = reuse_action.release_group_id if reuse_action else original_group
                actions = []
                for action in actions_by_group.get(lidarr_group, []):
                    if action.artist_mbid and action.artist_mbid != entry.result.primary_artist_id:
                        continue
                    requested_recordings = set(
                        (action.payload or {}).get("requested_recording_ids", [])
                    )
                    if requested_recordings and not requested_recordings.intersection(
                        entry.result.recording_ids
                    ):
                        continue
                    actions.append(action)
                displayed_match = next(
                    (action for action in actions if (action.payload or {}).get("matched_track")),
                    None,
                )
                release_artist = next(
                    (action for action in actions if action.artist_name or action.artist_mbid), None
                )
                releases.append(
                    {
                        "source_group": original_group,
                        "lidarr_group": lidarr_group,
                        "title": next(
                            (action.album_title for action in actions if action.album_title), ""
                        ),
                        "artist_name": (
                            release_artist.artist_name
                            if release_artist
                            else next(iter(entry.result.artist_names), "")
                        ),
                        "artist_mbid": (
                            release_artist.artist_mbid
                            if release_artist
                            else entry.result.primary_artist_id or ""
                        ),
                        "actions": actions,
                        "matched_track": (
                            (displayed_match.payload or {}).get("matched_track")
                            if displayed_match
                            else None
                        ),
                        "lidarr_album_id": (
                            (displayed_match.payload or {}).get("lidarr_album_id")
                            if displayed_match
                            else None
                        ),
                    }
                )
            artist_actions = list(actions_by_artist.get(entry.result.primary_artist_id or "", []))
            linked_actions = list(artist_actions)
            seen_action_ids = {id(action) for action in artist_actions}
            for release in releases:
                for action in release["actions"]:
                    if id(action) not in seen_action_ids:
                        seen_action_ids.add(id(action))
                        linked_actions.append(action)
            seen_action_names = {action.action for action in linked_actions}
            if not linked_actions and not entry.result.resolved_via:
                seen_action_names.add("skip")
            track_links.append(
                {
                    "entry": entry,
                    "releases": releases,
                    "actions": linked_actions,
                    "artist_actions": artist_actions,
                    "action_names": sorted(seen_action_names),
                    "mutates": bool(seen_action_names & mutating_action_names),
                    "various_artists_skip": any(
                        action.reason in {"various_artists_album", "various_artists_skipped"}
                        for action in linked_actions
                    ),
                    "various_artists_override": bool(
                        entry.evidence.get("allow_various_artists_release")
                    ),
                }
            )
        action_guide = [
            (
                "unchanged",
                "No change",
                "The selected release is already represented and configured in Lidarr.",
            ),
            (
                "reuse_downloaded_release",
                "Reuse downloaded release",
                "Bind the song to the release whose downloaded file already contains this recording; no Lidarr mutation by itself.",
            ),
            (
                "reuse_existing_release",
                "Reuse existing release",
                "Use an album already present in Lidarr; no duplicate album is created.",
            ),
            (
                "create_artist",
                "Create artist",
                "Add the MusicBrainz artist to Lidarr, initially without monitoring unrelated releases.",
            ),
            (
                "create_release",
                "Create release",
                "Add this specific MusicBrainz album, EP, or single to Lidarr.",
            ),
            (
                "monitor_artist",
                "Monitor artist",
                "Monitor the artist while keeping new-item monitoring disabled.",
            ),
            (
                "monitor_release",
                "Monitor release",
                "Turn monitoring on only when a requested recording is missing and must be acquired.",
            ),
            (
                "queue_search",
                "Queue search",
                "Ask Lidarr to search its indexers for the selected release.",
            ),
            (
                "skip",
                "Skip",
                "Make no Lidarr change because the binding is unresolved or excluded by a safety rule.",
            ),
        ]
        reason_guide = {
            "musicbrainz_unresolved": "No validated MusicBrainz recording is bound to this song.",
            "release_group_unresolved": "The recording has no selected MusicBrainz release group.",
            "various_artists_skipped": "Various Artists is excluded to avoid adding or broadly monitoring compilation artists.",
            "various_artists_album": "This release is a Various Artists compilation and is excluded by the Lidarr safety policy.",
            "artist_missing": "The artist is not yet present in Lidarr.",
            "release_missing": "This specific release is not yet present in Lidarr.",
            "requested_release": "This is the release selected for a missing playlist song.",
            "requested_track_missing": "The selected recording is not downloaded in Lidarr.",
            "downloaded_recording_match": "Lidarr already has this recording on the named release.",
            "release_exists_globally": "The release already exists elsewhere in the Lidarr library.",
            "already_monitored": "The release is already monitored; no configuration change is needed.",
            "already_downloaded_and_monitored": "The recording is downloaded and the release is already monitored.",
            "already_reconciled": "No Lidarr changes are needed for this artist.",
            "requested_recording_downloaded": "The requested recording file already exists; monitoring is not changed.",
            "monitored_with_new_items_disabled": "Monitor this artist only for explicitly selected releases; automatic new-release monitoring remains disabled.",
        }
        return render(
            request,
            "lidarr_plan.html",
            plan_id=plan_id,
            import_id=import_id,
            plan_status=status,
            plan=plan,
            summary=summary,
            execution=repository.lidarr_execution_results(plan_id),
            imported=imported,
            source=imported.source,
            workflow_step=2,
            track_links=track_links,
            action_guide=action_guide,
            reason_guide=reason_guide,
            lidarr_plan_id=plan_id,
        )
