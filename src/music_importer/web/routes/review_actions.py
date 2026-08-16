from __future__ import annotations

from dataclasses import replace

from fastapi import FastAPI, Form, HTTPException
from fastapi.responses import RedirectResponse

from ..presentation import WebUI
from ..review_support import ReviewSupport


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    support = ReviewSupport(context)
    mb_client = support.mb_client
    review_redirect = support.redirect

    @app.post("/entries/{entry_id}/reuse/{source_entry_id}")
    def reuse_manual_match(
        entry_id: int,
        source_entry_id: int,
        session: bool = Form(False),
        plan_id: str | None = Form(None),
    ):
        entry = repository.entry(entry_id)
        suggestions = repository.manual_match_suggestions(entry_id)
        suggestion = next((item for item in suggestions if item.entry.id == source_entry_id), None)
        if suggestion is None:
            raise HTTPException(409, "that manual match is not available for this track")
        source_entry = suggestion.entry
        evidence = dict(source_entry.evidence)
        evidence["reused_from_entry_id"] = source_entry.id
        evidence["reused_from_playlist"] = suggestion.playlist_name
        repository.save_manual_resolution(
            entry_id,
            source_entry.result,
            method="reused_manual",
            validation_status=source_entry.validation_status or "valid",
            evidence=evidence,
            selected_release_group_id=source_entry.selected_release_group_id,
        )
        if plan_id:
            return RedirectResponse(f"/plans/{plan_id}", status_code=303)
        remaining = repository.entries(entry.import_id)
        if not any(
            item.resolution_state
            in {"pending", "resolving", "unresolved", "ambiguous", "validation_failed"}
            for item in remaining
        ):
            repository.set_workflow_state(entry.import_id, "ready_to_plan")
        return review_redirect(entry, session)

    @app.post("/entries/{entry_id}/accept")
    def accept_entry(
        entry_id: int,
        mbid: str = Form(...),
        allow_warning: bool = Form(False),
        release_group_id: str | None = Form(None),
        method: str = Form("manual_mbid"),
        session: bool = Form(False),
        plan_id: str | None = Form(None),
    ):
        entry = repository.entry(entry_id)
        validation = mb_client().validate_recording_mbid(mbid, entry.track)
        if validation.status == "invalid" or validation.candidate is None:
            raise HTTPException(400, "invalid MusicBrainz recording mapping")
        if validation.status == "warning" and not allow_warning:
            raise HTTPException(400, "mapping has warnings and requires explicit confirmation")
        result = validation.candidate.result
        if len(result.release_group_ids) > 1 and not release_group_id:
            raise HTTPException(400, "select a release group for this recording")
        if release_group_id:
            if release_group_id not in result.release_group_ids:
                raise HTTPException(400, "release group is not associated with this recording")
            result = replace(result, release_group_ids=(release_group_id,))
        repository.save_manual_resolution(
            entry_id,
            result,
            method=method,
            validation_status=validation.status,
            evidence=validation.candidate.evidence or {},
            selected_release_group_id=release_group_id,
        )
        if plan_id:
            return RedirectResponse(f"/plans/{plan_id}", status_code=303)
        remaining = repository.entries(entry.import_id)
        if not any(
            item.resolution_state
            in {"pending", "resolving", "unresolved", "ambiguous", "validation_failed"}
            for item in remaining
        ):
            repository.set_workflow_state(entry.import_id, "ready_to_plan")
        return review_redirect(entry, session)

    @app.post("/entries/{entry_id}/retry")
    def retry_entry(entry_id: int, plan_id: str | None = Form(None)):
        entry = repository.entry(entry_id)
        if entry.is_manual:
            if not plan_id:
                raise HTTPException(400, "clear the manual override before retrying automation")
            repository.clear_manual_resolution(entry_id)

        def operation(job_id: str) -> None:
            repository.mark_resolving(entry_id)
            result = mb_client().resolve(entry.track)
            repository.save_automatic_resolution(entry_id, result)
            all_entries = repository.entries(entry.import_id)
            repository.set_workflow_state(
                entry.import_id,
                "review_required"
                if any(
                    item.resolution_state in {"unresolved", "ambiguous", "validation_failed"}
                    for item in all_entries
                )
                else "ready_to_plan",
            )
            repository.update_job(
                job_id,
                current=1,
                total=1,
                current_item=f"{', '.join(entry.track.artists)} — {entry.track.title}",
            )

        job = context.tasks.submit("resolution_retry", operation, entry.import_id, total=1)
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)

    @app.post("/entries/{entry_id}/skip")
    def skip_entry(entry_id: int, session: bool = Form(False), plan_id: str | None = Form(None)):
        entry = repository.entry(entry_id)
        repository.mark_skipped(entry_id)
        remaining = repository.entries(entry.import_id)
        if not any(
            item.resolution_state
            in {"pending", "resolving", "unresolved", "ambiguous", "validation_failed"}
            for item in remaining
        ):
            repository.set_workflow_state(entry.import_id, "ready_to_plan")
        if plan_id:
            return RedirectResponse(f"/plans/{plan_id}", status_code=303)
        return review_redirect(entry, session)

    @app.post("/entries/{entry_id}/clear-override")
    def clear_override(entry_id: int):
        entry = repository.entry(entry_id)
        repository.clear_manual_resolution(entry_id)
        repository.set_workflow_state(entry.import_id, "review_required")
        return RedirectResponse(f"/imports/{entry.import_id}", status_code=303)
