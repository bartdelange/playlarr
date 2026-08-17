from urllib.parse import quote

from fastapi import FastAPI, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from ...integrations.navidrome import NavidromeClient
from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    render = ui.render

    @app.get("/imports/{import_id}/local-additions", response_class=HTMLResponse)
    def local_additions(
        request: Request, import_id: str, q: str = Query(""), error: str = Query("")
    ):
        try:
            imported = repository.get_import(import_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        results = []
        if q.strip():
            try:
                results = NavidromeClient(context.config).search_songs(q.strip())
            except Exception as exc:
                error = str(exc)
        return render(
            request,
            "local_additions.html",
            imported=imported,
            additions=repository.local_playlist_additions(import_id),
            results=results,
            query=q,
            error=error,
        )

    @app.post("/imports/{import_id}/local-additions")
    def add_local_addition(import_id: str, song_id: str = Form(...)):
        repository.get_import(import_id)
        try:
            song = NavidromeClient(context.config).song(song_id)
            repository.add_local_playlist_track(
                import_id,
                "navidrome",
                song.id,
                song.title,
                (song.artist,) if song.artist else (),
                song.album,
                song.path,
            )
        except Exception as exc:
            return RedirectResponse(
                f"/imports/{import_id}/local-additions?error={quote(str(exc))}", status_code=303
            )
        return RedirectResponse(f"/imports/{import_id}/local-additions", status_code=303)

    @app.post("/imports/{import_id}/local-additions/{addition_id}/delete")
    def remove_local_addition(import_id: str, addition_id: int):
        try:
            repository.remove_local_playlist_track(import_id, addition_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        return RedirectResponse(f"/imports/{import_id}/local-additions", status_code=303)
