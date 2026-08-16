"""Removal of unwanted persisted import workflows."""

from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse

from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    repository = ui.context.repository

    @app.post("/imports/{import_id}/delete")
    def delete_import(import_id: str):
        try:
            repository.delete_import(import_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        return RedirectResponse("/", status_code=303)
