from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    render = ui.render
    workflow_step = ui.workflow_step
    job_completion_url = ui.job_completion_url

    @app.get("/jobs/{job_id}", response_class=HTMLResponse)
    def job_page(request: Request, job_id: str):
        try:
            job = repository.get_job(job_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        imported = repository.get_import(job.import_id) if job.import_id else None
        completion_url = job_completion_url(job)
        return render(
            request,
            "job.html",
            job=job,
            imported=imported,
            source=imported.source if imported else None,
            workflow_step=workflow_step(imported) if imported else None,
            completion_url=completion_url,
        )

    @app.get("/jobs", response_class=HTMLResponse)
    def jobs_page(request: Request):
        jobs = repository.list_jobs()
        queue_positions: dict[str, int] = {}
        position = 0
        for job in jobs:
            if job.status == "queued":
                position += 1
                queue_positions[job.id] = position
        return render(request, "jobs.html", jobs=jobs, queue_positions=queue_positions)

    @app.get("/api/jobs/{job_id}")
    def job_status(job_id: str):
        try:
            job = repository.get_job(job_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        return {
            "id": job.id,
            "import_id": job.import_id,
            "kind": job.kind,
            "status": job.status,
            "current": job.current,
            "total": job.total,
            "current_item": job.current_item,
            "error": job.error,
            "completion_url": job_completion_url(job),
        }

    @app.post("/jobs/{job_id}/cancel")
    def cancel_job(job_id: str):
        repository.request_job_cancel(job_id)
        return RedirectResponse(f"/jobs/{job_id}", status_code=303)
