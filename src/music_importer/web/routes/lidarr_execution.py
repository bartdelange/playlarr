from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse

from ...application.library_status import LibraryStatusService
from ...integrations.lidarr import LidarrClient
from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    config = context.config

    @app.post("/plans/{plan_id}/execute")
    def execute_lidarr_plan(plan_id: str):
        import_id, _, plan = repository.get_lidarr_plan(plan_id)
        entries = repository.entries(import_id)
        artist_count = len(
            {entry.result.primary_artist_id for entry in entries if entry.result.primary_artist_id}
        )
        status_work = 2 + artist_count * 2
        try:
            repository.approve_lidarr_plan(plan_id)
        except ValueError as exc:
            raise HTTPException(
                409, "this plan was replaced after a binding changed; open the latest plan"
            ) from exc

        def operation(job_id: str) -> None:
            def progress(current: int, total: int, item: str) -> None:
                repository.update_job(
                    job_id,
                    current=current,
                    total=len(plan.actions) + status_work,
                    current_item=item,
                )

            lidarr = LidarrClient(config)
            execution = lidarr.execute_plan(plan, progress)
            repository.record_lidarr_execution(plan_id, execution)
            statuses = LibraryStatusService(lidarr).refresh(
                [entry.result for entry in entries],
                lambda current, total, item: progress(len(plan.actions) + current, total, item),
            )
            repository.save_library_status(import_id, statuses)

        job = context.tasks.submit(
            "lidarr_execution",
            operation,
            import_id,
            total=len(plan.actions) + status_work,
        )
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)

    @app.post("/imports/{import_id}/library-status")
    def refresh_library_status(import_id: str):
        if not config.lidarr_enabled:
            raise HTTPException(400, "Lidarr is not configured")
        entries = repository.entries(import_id)
        imported = repository.get_import(import_id)
        if imported.workflow_state not in {
            "waiting_for_downloads",
            "library_status",
            "playlist_generated",
        }:
            raise HTTPException(409, "apply a Lidarr plan before refreshing downloads")
        if not any(entry.result.resolved_via for entry in entries):
            raise HTTPException(409, "there are no resolved tracks to check")

        def operation(job_id: str) -> None:
            def progress(current: int, total: int, item: str) -> None:
                repository.update_job(job_id, current=current, total=total, current_item=item)

            statuses = LibraryStatusService(LidarrClient(config)).refresh(
                [entry.result for entry in entries], progress
            )
            repository.save_library_status(import_id, statuses)

        artist_count = len(
            {entry.result.primary_artist_id for entry in entries if entry.result.primary_artist_id}
        )
        job = context.tasks.submit(
            "library_status", operation, import_id, total=2 + artist_count * 2
        )
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)
