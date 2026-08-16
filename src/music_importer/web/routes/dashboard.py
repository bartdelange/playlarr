from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse

from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    render = ui.render

    @app.get("/health", include_in_schema=False)
    def health():
        return {"status": "ok"}

    @app.get("/", response_class=HTMLResponse)
    def dashboard(request: Request):
        items = repository.list_imports()
        jobs = repository.list_jobs(limit=4)
        active_jobs = {
            job.import_id: job
            for job in jobs
            if job.import_id and job.status in {"queued", "running"}
        }
        playlists = []
        for item in items:
            entries = repository.entries(item.id)
            pending = sum(entry.resolution_state in {"pending", "resolving"} for entry in entries)
            review = sum(
                entry.resolution_state in {"unresolved", "ambiguous", "validation_failed"}
                for entry in entries
            )
            resolved = sum(bool(entry.result.resolved_via) for entry in entries)
            if pending:
                next_action = f"Resolve {pending} tracks"
            elif review:
                next_action = f"Review {review} tracks"
            elif item.workflow_state in {"ready_to_plan", "plan_ready"}:
                next_action = "Review Lidarr mapping"
            elif item.workflow_state == "waiting_for_downloads":
                next_action = "Check downloads"
            elif item.workflow_state == "library_status":
                next_action = "Generate playlist"
            elif item.workflow_state == "playlist_generated":
                next_action = "Playlist ready"
            else:
                next_action = item.workflow_state.replace("_", " ").title()
            playlists.append(
                {
                    "imported": item,
                    "tracks": len(entries),
                    "resolved": resolved,
                    "review": review,
                    "next_action": next_action,
                    "job": active_jobs.get(item.id),
                }
            )
        counts = {
            "review": sum(item.workflow_state == "review_required" for item in items),
            "waiting": sum(
                item.workflow_state in {"waiting_for_downloads", "library_status"} for item in items
            ),
            "complete": sum(item.workflow_state == "playlist_generated" for item in items),
        }
        return render(request, "dashboard.html", counts=counts, jobs=jobs, playlists=playlists)
