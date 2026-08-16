from __future__ import annotations

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from ..presentation import WebUI
from ..review_support import ReviewSupport


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    render = ui.render
    support = ReviewSupport(context)
    mb_client = support.mb_client
    review_session_values = support.session_values

    @app.get("/imports/{import_id}/review")
    def start_review_session(import_id: str):
        imported = repository.get_import(import_id)
        queue = support.queue(imported.id)
        if not queue:
            return RedirectResponse(f"/imports/{import_id}", status_code=303)
        return RedirectResponse(f"/entries/{queue[0].id}/review?session=true", status_code=303)

    @app.get("/entries/{entry_id}/review", response_class=HTMLResponse)
    def review_entry(
        request: Request,
        entry_id: int,
        q: str | None = None,
        session: bool = False,
        plan_id: str | None = None,
    ):
        try:
            entry = repository.entry(entry_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        candidates = mb_client().search_candidates(entry.track, q) if q is not None else []
        if candidates:
            repository.save_candidates(entry_id, candidates)
        imported = repository.get_import(entry.import_id)
        return render(
            request,
            "manual_review.html",
            entry=entry,
            candidates=candidates,
            validation=None,
            query=q or "",
            imported=imported,
            source=imported.source,
            workflow_step=1,
            match_suggestions=repository.manual_match_suggestions(entry_id),
            plan_id=plan_id,
            **review_session_values(entry, session),
        )

    @app.post("/entries/{entry_id}/validate", response_class=HTMLResponse)
    def validate_entry(
        request: Request,
        entry_id: int,
        mbid: str = Form(...),
        method: str = Form("manual_mbid"),
        session: bool = Form(False),
        plan_id: str | None = Form(None),
    ):
        try:
            entry = repository.entry(entry_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        validation = mb_client().validate_recording_mbid(mbid, entry.track)
        if validation.status == "invalid":
            repository.mark_validation_failed(entry_id, validation.errors)
        imported = repository.get_import(entry.import_id)
        return render(
            request,
            "manual_review.html",
            entry=entry,
            candidates=[],
            validation=validation,
            mbid=mbid,
            manual_method=method,
            query="",
            imported=imported,
            source=imported.source,
            workflow_step=1,
            match_suggestions=repository.manual_match_suggestions(entry_id),
            plan_id=plan_id,
            **review_session_values(entry, session),
        )
