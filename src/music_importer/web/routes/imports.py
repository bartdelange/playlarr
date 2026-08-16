from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from ...application.import_service import PersistentImportService
from ...application.library_status import library_availability
from ...application.resolution import ResolutionProgress
from ...integrations.musicbrainz import MusicBrainzClient
from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    config = context.config
    render = ui.render
    workflow_step = ui.workflow_step

    @app.get("/imports/{import_id}", response_class=HTMLResponse)
    def import_detail(request: Request, import_id: str, stage: str | None = None):
        try:
            imported = repository.get_import(import_id)
            canonical = repository.find_import(imported.source, imported.source_playlist_id)
            if canonical is not None and canonical.id != imported.id:
                return RedirectResponse(f"/imports/{canonical.id}", status_code=307)
            entries = repository.entries(import_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        plan = repository.latest_lidarr_plan(import_id)
        if stage == "lidarr" and plan:
            return RedirectResponse(f"/plans/{plan[0]}", status_code=307)
        if stage in {"final", "export"} and not plan:
            return RedirectResponse(f"/imports/{import_id}?stage=lidarr", status_code=307)
        if stage is None and workflow_step(imported, entries) == 2:
            target = f"/plans/{plan[0]}" if plan else f"/imports/{import_id}?stage=lidarr"
            return RedirectResponse(target, status_code=307)
        if stage == "lidarr":
            return render(
                request,
                "lidarr_empty.html",
                imported=imported,
                source=imported.source,
                workflow_step=2,
            )
        library = repository.library_status(import_id)
        execution_context: dict[int, list[dict]] = {}
        lidarr_matches: dict[int, dict] = {}
        if plan:
            for entry in entries:
                for action in plan[3].actions:
                    matched_track = (action.payload or {}).get("matched_track")
                    if not matched_track or action.artist_mbid != entry.result.primary_artist_id:
                        continue
                    requested = set((action.payload or {}).get("requested_recording_ids", []))
                    if requested and not requested.intersection(entry.result.recording_ids):
                        continue
                    source_groups = set((action.payload or {}).get("mapped_release_group_ids", []))
                    if action.release_group_id in entry.result.release_group_ids:
                        source_groups.add(action.release_group_id)
                    if not source_groups.intersection(entry.result.release_group_ids):
                        continue
                    lidarr_matches[entry.position] = {
                        "track": matched_track,
                        "album_title": action.album_title,
                        "release_group_id": action.release_group_id,
                        "album_id": (action.payload or {}).get("lidarr_album_id"),
                    }
                    break
        if plan and plan[2] in {"completed", "failed"}:
            executed = {
                item["action_position"]: item
                for item in repository.lidarr_execution_results(plan[0])
            }
            for entry in entries:
                relevant = []
                for position, action in enumerate(plan[3].actions):
                    if action.artist_mbid != entry.result.primary_artist_id:
                        continue
                    if (
                        action.release_group_id
                        and action.release_group_id not in entry.result.release_group_ids
                    ):
                        mapped = set((action.payload or {}).get("mapped_release_group_ids", []))
                        if not mapped.intersection(entry.result.release_group_ids):
                            continue
                    requested = set((action.payload or {}).get("requested_recording_ids", []))
                    if requested and not requested.intersection(entry.result.recording_ids):
                        continue
                    outcome = executed.get(position)
                    if outcome:
                        relevant.append(
                            {
                                "action": action.action,
                                "reason": action.reason,
                                "outcome": outcome["outcome"],
                                "details": outcome["details"],
                            }
                        )
                if relevant:
                    execution_context[entry.position] = relevant
        library_availability_by_position = {}
        for position, (classification, path) in library.items():
            availability = library_availability(classification, path)
            if any(
                item.get("reason") in {"various_artists_album", "various_artists_skipped"}
                for item in execution_context.get(position, [])
            ):
                availability = "not_downloadable"
            library_availability_by_position[position] = availability
        library_availability_counts = {
            availability: sum(
                value == availability for value in library_availability_by_position.values()
            )
            for availability in ("downloaded", "downloadable", "not_downloadable")
        }
        resolvable_states = {"pending", "resolving", "unresolved", "ambiguous", "validation_failed"}
        resolvable_count = sum(entry.resolution_state in resolvable_states for entry in entries)
        pending_count = sum(entry.resolution_state in {"pending", "resolving"} for entry in entries)
        review_count = sum(
            entry.resolution_state in {"unresolved", "ambiguous", "validation_failed"}
            for entry in entries
        )
        has_resolvable = resolvable_count > 0
        has_mappings = any(entry.result.resolved_via for entry in entries)
        can_plan = has_mappings and not has_resolvable
        can_refresh = has_mappings and imported.workflow_state in {
            "waiting_for_downloads",
            "library_status",
            "playlist_generated",
        }
        can_generate = has_mappings and imported.workflow_state in {
            "library_status",
            "playlist_generated",
        }
        requested_steps = {
            "match": 1,
            "resolve": 1,
            "review": 1,
            "lidarr": 2,
            "final": 3,
            "export": 3,
        }
        default_step = workflow_step(imported, entries)
        # The import route owns Music match and Final. Lidarr plans have their own pages.
        if default_step == 2:
            default_step = 1
        selected_step = requested_steps.get(stage, default_step)
        return render(
            request,
            "import_detail.html",
            imported=imported,
            entries=entries,
            stored_plan=plan,
            library=library,
            latest_export=repository.latest_playlist_export(import_id),
            has_resolvable=has_resolvable,
            resolvable_count=resolvable_count,
            pending_count=pending_count,
            review_count=review_count,
            has_mappings=has_mappings,
            can_plan=can_plan,
            can_refresh=can_refresh,
            can_generate=can_generate,
            workflow_step=selected_step,
            source=imported.source,
            selected_stage=stage,
            lidarr_plan_id=plan[0] if plan else None,
            execution_context=execution_context,
            lidarr_matches=lidarr_matches,
            library_availability=library_availability_by_position,
            library_availability_counts=library_availability_counts,
            revisions=repository.playlist_revisions(import_id),
            mapping_source_count=sum(item.id != import_id for item in repository.list_imports()),
        )

    @app.post("/imports/{import_id}/resolve")
    def resolve_import(import_id: str):
        repository.get_import(import_id)
        entries = repository.entries(import_id)

        def operation(job_id: str) -> None:
            resolver = MusicBrainzClient(
                config.mb_base_url,
                config.mb_user_agent,
                config.mb_request_delay,
                config.mb_timeout,
                config.mb_max_retries,
            )

            def progress(item: ResolutionProgress) -> None:
                repository.update_job(
                    job_id,
                    current=item.current,
                    total=item.total,
                    current_item=f"{', '.join(item.track.artists)} — {item.track.title}",
                )

            PersistentImportService(repository).resolve(
                import_id, resolver, progress, lambda: repository.get_job(job_id).cancel_requested
            )

        job = context.tasks.submit("resolution", operation, import_id, total=len(entries))
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)
