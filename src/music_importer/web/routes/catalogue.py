from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse

from ...application.import_service import PersistentImportService
from ...application.resolution import ResolutionProgress, ResolutionService
from ...domain.models import PlaylistInfo
from ...exports.artist_impact import artist_additions
from ...exports.csv_compat import import_mapping_csv
from ...integrations.lidarr import LidarrClient
from ...integrations.musicbrainz import MusicBrainzClient
from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    config = context.config
    render = ui.render
    playlist_info_from_payload = ui.playlist_info_from_payload

    def mb_client() -> MusicBrainzClient:
        return MusicBrainzClient(
            config.mb_base_url,
            config.mb_user_agent,
            config.mb_request_delay,
            config.mb_timeout,
            config.mb_max_retries,
        )

    @app.get("/imports/new", response_class=HTMLResponse)
    def new_import(request: Request, source: str | None = None, catalog_job: str | None = None):
        playlists = None
        error = None
        if source:
            if catalog_job is None:
                try:
                    adapter = context.source(source)
                except Exception as exc:
                    error = str(exc)
                    adapter = None

                if adapter is not None:

                    def operation(job_id: str) -> None:
                        repository.update_job(job_id, current_item=f"Loading {source} playlists")
                        adapter.login()
                        loaded = adapter.list_playlists()
                        repository.save_job_result(
                            job_id,
                            {"source": source, "playlists": [asdict(item) for item in loaded]},
                        )
                        repository.update_job(
                            job_id,
                            current=len(loaded),
                            total=len(loaded),
                            current_item=f"Loaded {len(loaded)} playlists",
                        )

                    job = context.tasks.submit("playlist_catalogue", operation)
                    return RedirectResponse(f"/jobs/{job.id}", status_code=303)

            else:
                try:
                    job = repository.get_job(catalog_job)
                    result = repository.job_result(catalog_job)
                except KeyError as exc:
                    raise HTTPException(404, str(exc)) from exc
                if (
                    job.kind != "playlist_catalogue"
                    or job.status != "completed"
                    or not result
                    or result.get("source") != source
                ):
                    raise HTTPException(409, "playlist catalogue is not ready for this source")
                playlists = [playlist_info_from_payload(item) for item in result["playlists"]]
        analyses = repository.playlist_analyses(source) if source else {}
        existing_imports = (
            {
                item.source_playlist_id: item
                for item in repository.list_imports()
                if item.source == source
            }
            if source
            else {}
        )
        return render(
            request,
            "new_import.html",
            source=source,
            playlists=playlists,
            error=error,
            analyses=analyses,
            existing_imports=existing_imports,
            new_import_step=2 if source else 1,
            imported=None,
        )

    @app.post("/imports")
    def create_import(source: str = Form(...), playlist_id: str = Form(...)):
        existing = repository.find_import(source, playlist_id)
        if existing is not None:
            return RedirectResponse(f"/imports/{existing.id}", status_code=303)
        try:
            adapter = context.source(source)
        except Exception as exc:
            raise HTTPException(400, str(exc)) from exc
        imported = repository.create_import(PlaylistInfo(source, playlist_id, "Loading playlist…"))

        def operation(job_id: str) -> None:
            try:
                repository.update_job(job_id, current_item="Fetching playlist metadata")
                adapter.login()
                playlist = adapter.get_playlist(playlist_id)
                repository.update_job(
                    job_id,
                    total=playlist.track_count or 1,
                    current_item=f"Importing {playlist.name}",
                )
                PersistentImportService(repository).acquire_into(imported.id, adapter, playlist)
                repository.update_job(
                    job_id,
                    current=playlist.track_count or len(repository.entries(imported.id)) or 1,
                    current_item=f"Imported {playlist.name}",
                )
            except Exception as exc:
                repository.set_workflow_state(imported.id, "acquisition_failed", str(exc))
                raise

        job = context.tasks.submit("playlist_acquisition", operation, imported.id)
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)

    @app.post("/playlists/{source}/{playlist_id}/analyze")
    def analyze_playlist(source: str, playlist_id: str):
        if not config.lidarr_enabled:
            raise HTTPException(400, "Lidarr is required for impact analysis")
        adapter = context.source(source)

        def operation(job_id: str) -> None:
            repository.update_job(job_id, current_item="Fetching playlist metadata")
            adapter.login()
            playlist = adapter.get_playlist(playlist_id)
            if playlist.is_followed:
                repository.save_playlist_analysis(
                    source, playlist_id, playlist.name, "skipped_followed", {}
                )
                repository.update_job(job_id, current=1, total=1, current_item="Analysis skipped")
                return
            repository.update_job(
                job_id,
                total=playlist.track_count or 0,
                current_item=f"Loading tracks from {playlist.name}",
            )
            tracks = adapter.get_tracks(playlist)

            def progress(item: ResolutionProgress) -> None:
                repository.update_job(
                    job_id,
                    current=item.current,
                    total=item.total,
                    current_item=f"{', '.join(item.track.artists)} — {item.track.title}",
                )

            batch = ResolutionService(mb_client()).resolve_tracks(tracks, progress)
            missing, _ = LidarrClient(config).compare(batch.results)
            additions = artist_additions(batch.results, missing)
            repository.save_playlist_analysis(
                source,
                playlist_id,
                playlist.name,
                "complete",
                {
                    "tracks": len(tracks),
                    "resolved": len(tracks) - batch.summary.unresolved,
                    "unresolved": batch.summary.unresolved,
                    "artists_to_add": len(additions),
                    "artist_names": [item["artist_name"] for item in additions],
                },
            )

        job = context.tasks.submit("playlist_analysis", operation)
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)

    @app.post("/imports/from-csv")
    async def create_import_from_csv(mapping: UploadFile):
        import tempfile

        suffix = Path(mapping.filename or "mapping.csv").suffix or ".csv"
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
                temporary = Path(handle.name)
                while chunk := await mapping.read(1024 * 1024):
                    handle.write(chunk)
            imported = import_mapping_csv(
                temporary, repository, Path(mapping.filename or "Imported playlist").stem
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        finally:
            if "temporary" in locals():
                temporary.unlink(missing_ok=True)
        return RedirectResponse(f"/imports/{imported.id}", status_code=303)
