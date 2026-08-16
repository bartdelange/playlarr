from __future__ import annotations

from dataclasses import asdict

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from ...domain.models import AcquiredTrack
from ...domain.playlist_updates import playlist_snapshot_token
from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    render = ui.render
    playlist_info_from_payload = ui.playlist_info_from_payload
    acquired_track_from_payload = ui.acquired_track_from_payload

    def current_playlist_entries(imported):
        adapter = context.source(imported.source)
        adapter.login()
        playlist = adapter.get_playlist(imported.source_playlist_id)
        entries = (
            adapter.get_entries(playlist)
            if hasattr(adapter, "get_entries")
            else [
                AcquiredTrack(position, track)
                for position, track in enumerate(adapter.get_tracks(playlist))
            ]
        )
        return playlist, entries

    @app.get("/imports/{import_id}/update", response_class=HTMLResponse)
    def preview_playlist_update(request: Request, import_id: str, preview_job: str | None = None):
        try:
            imported = repository.get_import(import_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc

        if preview_job is None:

            def operation(job_id: str) -> None:
                repository.update_job(job_id, current_item="Fetching the current source playlist")
                playlist, entries = current_playlist_entries(imported)
                repository.save_job_result(
                    job_id,
                    {"playlist": asdict(playlist), "entries": [asdict(item) for item in entries]},
                )
                repository.update_job(
                    job_id,
                    current=len(entries),
                    total=len(entries),
                    current_item="Playlist update preview ready",
                )

            job = context.tasks.submit("playlist_update_preview", operation, import_id)
            return RedirectResponse(f"/jobs/{job.id}", status_code=303)

        try:
            job = repository.get_job(preview_job)
            result = repository.job_result(preview_job)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        if (
            job.import_id != import_id
            or job.kind != "playlist_update_preview"
            or job.status != "completed"
            or not result
        ):
            raise HTTPException(409, "playlist update preview is not ready")
        playlist = playlist_info_from_payload(result["playlist"])
        entries = [acquired_track_from_payload(item) for item in result["entries"]]
        update = repository.preview_playlist_update(import_id, entries)
        return render(
            request,
            "playlist_update.html",
            imported=imported,
            playlist=playlist,
            update=update,
            entries=entries,
            current_entries=repository.entries(import_id),
            update_token=playlist_snapshot_token(entries),
            preview_job=preview_job,
        )

    @app.post("/imports/{import_id}/update")
    def apply_playlist_update(
        import_id: str,
        update_token: str = Form(...),
        preview_job: str = Form(...),
    ):
        try:
            repository.get_import(import_id)
            if any(
                job.import_id == import_id and job.status in {"queued", "running"}
                for job in repository.list_jobs()
            ):
                raise HTTPException(409, "wait for the active playlist job before updating")
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except HTTPException:
            raise

        def operation(job_id: str) -> None:
            preview = repository.get_job(preview_job)
            result = repository.job_result(preview_job)
            if (
                preview.import_id != import_id
                or preview.kind != "playlist_update_preview"
                or preview.status != "completed"
                or not result
            ):
                raise ValueError("playlist update preview is not ready")
            playlist = playlist_info_from_payload(result["playlist"])
            entries = [acquired_track_from_payload(item) for item in result["entries"]]
            if update_token != playlist_snapshot_token(entries):
                raise ValueError("the source playlist changed; preview the update again")

            repository.update_job(
                job_id, current=1, current_item="Applying the approved playlist update"
            )
            update = repository.preview_playlist_update(import_id, entries)
            if update.added or update.removed or update.moved:
                repository.apply_playlist_update(import_id, playlist, entries)
            repository.update_job(job_id, current=2, current_item="Playlist update complete")

        job = context.tasks.submit("playlist_update", operation, import_id, total=2)
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)

    @app.get("/imports/{import_id}/revisions/{revision_id}", response_class=HTMLResponse)
    def playlist_revision(request: Request, import_id: str, revision_id: str):
        try:
            imported = repository.get_import(import_id)
            revision = repository.playlist_revision(import_id, revision_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        return render(request, "playlist_revision.html", imported=imported, revision=revision)
