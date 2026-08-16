from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse

from ...application.playlist_export import PlaylistExportService
from ...exports.m3u import write_m3u
from ...integrations.lidarr import LidarrClient
from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    config = context.config

    @app.post("/imports/{import_id}/playlist")
    def generate_playlist(import_id: str):
        if not config.lidarr_enabled:
            raise HTTPException(400, "Lidarr is not configured")
        imported = repository.get_import(import_id)
        entries = repository.entries(import_id)
        if imported.workflow_state not in {"library_status", "playlist_generated"}:
            raise HTTPException(409, "refresh download status before generating a playlist")
        if not any(entry.result.resolved_via for entry in entries):
            raise HTTPException(409, "there are no resolved tracks to export")

        def operation(job_id: str) -> None:
            path_mappings = [
                tuple(item)
                for item in repository.get_setting(
                    "path_mappings", [[config.lidarr_root_folder, config.lidarr_root_folder]]
                )
            ]
            export = PlaylistExportService(LidarrClient(config)).build(
                [entry.track for entry in entries],
                [entry.result for entry in entries],
                path_mappings,
            )
            safe_name = (
                "".join(
                    character if character.isalnum() or character in "-_" else "-"
                    for character in imported.playlist_name
                ).strip("-")
                or "playlist"
            )
            output = (
                config.output_dir
                / f"{imported.source}_{safe_name}_{imported.source_playlist_id}.m3u8"
            )
            write_m3u(output, export)
            repository.record_playlist_export(
                import_id,
                output,
                len(export.entries),
                len(export.missing),
            )
            repository.update_job(job_id, current=len(entries), total=len(entries))

        job = context.tasks.submit("playlist_generation", operation, import_id, total=len(entries))
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)
