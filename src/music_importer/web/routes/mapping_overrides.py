from __future__ import annotations

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    repository = ui.context.repository

    @app.get("/imports/{import_id}/mapping-overrides", response_class=HTMLResponse)
    def mapping_override_preview(
        request: Request, import_id: str, source_import_id: str | None = None
    ):
        try:
            imported = repository.get_import(import_id)
            sources = [item for item in repository.list_imports() if item.id != import_id]
            candidates = (
                repository.mapping_override_candidates(import_id, source_import_id)
                if source_import_id
                else []
            )
            selected_source = repository.get_import(source_import_id) if source_import_id else None
        except (KeyError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc
        return ui.render(
            request,
            "mapping_overrides.html",
            imported=imported,
            sources=sources,
            selected_source=selected_source,
            candidates=candidates,
        )

    @app.post("/imports/{import_id}/mapping-overrides")
    def apply_mapping_overrides(
        import_id: str,
        source_import_id: str = Form(...),
        target_entry_ids: list[int] = Form(default=[]),
    ):
        try:
            repository.get_import(import_id)
            repository.get_import(source_import_id)
            repository.apply_mapping_overrides(import_id, source_import_id, set(target_entry_ids))
        except (KeyError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc
        return RedirectResponse(f"/imports/{import_id}?stage=match", status_code=303)
