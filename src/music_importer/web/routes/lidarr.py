from __future__ import annotations

from dataclasses import replace

import requests
from fastapi import FastAPI, Form, HTTPException
from fastapi.responses import RedirectResponse

from ...integrations.lidarr import LidarrClient
from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    config = context.config

    def submit_lidarr_plan(import_id: str):
        if not config.lidarr_enabled:
            raise HTTPException(400, "Lidarr is not configured")
        entries = repository.entries(import_id)
        blockers = {"pending", "resolving", "unresolved", "ambiguous", "validation_failed"}
        if any(entry.resolution_state in blockers for entry in entries):
            raise HTTPException(409, "resolve, manually match, or skip every review item first")
        if not any(entry.result.resolved_via for entry in entries):
            raise HTTPException(409, "there are no resolved tracks to plan")

        artist_count = len(
            {entry.result.primary_artist_id for entry in entries if entry.result.primary_artist_id}
        )

        def operation(job_id: str) -> None:
            def progress(current: int, total: int, item: str) -> None:
                repository.update_job(job_id, current=current, total=total, current_item=item)

            try:
                plan = LidarrClient(config).plan(
                    [entry.result for entry in entries],
                    progress,
                    {
                        recording_id
                        for entry in entries
                        if entry.evidence.get("allow_various_artists_release")
                        for recording_id in entry.result.recording_ids
                    },
                )
            except requests.Timeout as exc:
                raise RuntimeError(
                    f"{exc}. Lidarr is reachable, but this request did not complete; "
                    "retry the plan."
                ) from exc
            repository.save_lidarr_plan(import_id, plan)
            repository.update_job(job_id, current=len(plan.actions), total=len(plan.actions))

        return context.tasks.submit("lidarr_planning", operation, import_id, total=artist_count + 1)

    @app.post("/imports/{import_id}/plan")
    def plan_lidarr(import_id: str):
        job = submit_lidarr_plan(import_id)
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)

    @app.post("/plans/{plan_id}/entries/{entry_id}/release")
    def change_plan_release(plan_id: str, entry_id: int, release_group_id: str = Form(...)):
        import_id, status, _ = repository.get_lidarr_plan(plan_id)
        if status not in {"draft", "superseded"}:
            raise HTTPException(409, "an applied plan cannot be edited")
        entry = repository.entry(entry_id)
        if entry.import_id != import_id:
            raise HTTPException(409, "track does not belong to this plan")
        if release_group_id not in entry.result.release_group_ids:
            raise HTTPException(400, "release group is not associated with this recording")
        repository.save_manual_resolution(
            entry_id,
            replace(entry.result, release_group_ids=(release_group_id,)),
            method="reused_manual" if entry.resolution_method == "reused_manual" else "manual_mbid",
            validation_status=entry.validation_status or "valid",
            evidence=entry.evidence,
            selected_release_group_id=release_group_id,
        )
        return RedirectResponse(f"/plans/{plan_id}", status_code=303)

    @app.post("/plans/{plan_id}/entries/{entry_id}/allow-va")
    def allow_various_artists_release(plan_id: str, entry_id: int):
        import_id, status, _ = repository.get_lidarr_plan(plan_id)
        entry = repository.entry(entry_id)
        if entry.import_id != import_id:
            raise HTTPException(409, "track does not belong to this plan")
        repository.set_various_artists_override(entry_id, True)
        location = (
            f"/plans/{plan_id}" if status in {"draft", "superseded"} else f"/imports/{import_id}"
        )
        return RedirectResponse(location, status_code=303)
