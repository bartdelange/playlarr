from __future__ import annotations

import logging
from dataclasses import is_dataclass, replace

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from ...config import serializable_config, service_config_values
from ...integrations.lidarr import LidarrClient
from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    config = context.config
    render = ui.render

    @app.get("/settings", response_class=HTMLResponse)
    def settings(request: Request, message: str | None = None):
        return render(
            request,
            "settings.html",
            path_mappings=repository.get_setting(
                "path_mappings", [[config.lidarr_root_folder, config.lidarr_root_folder]]
            ),
            message=message,
        )

    @app.post("/settings/services")
    def save_services(
        mb_user_agent: str = Form(""),
        spotify_client_id: str = Form(""),
        spotify_redirect_uri: str = Form(""),
        lidarr_url: str = Form(""),
        lidarr_api_key: str = Form(""),
        lidarr_root_folder: str = Form(""),
        lidarr_quality_profile_id: int = Form(1),
        lidarr_metadata_profile_id: int = Form(1),
        output_dir: str = Form("output"),
        debug_logging: bool = Form(False),
    ):
        nonlocal config
        previous = repository.get_setting("service_config", {})
        values = service_config_values(
            config,
            previous,
            mb_user_agent=mb_user_agent,
            spotify_client_id=spotify_client_id,
            spotify_redirect_uri=spotify_redirect_uri,
            lidarr_url=lidarr_url,
            lidarr_api_key=lidarr_api_key,
            lidarr_root_folder=lidarr_root_folder,
            lidarr_quality_profile_id=lidarr_quality_profile_id,
            lidarr_metadata_profile_id=lidarr_metadata_profile_id,
            output_dir=output_dir,
        )
        repository.set_setting("debug_logging", debug_logging)
        logging.getLogger().setLevel(logging.DEBUG if debug_logging else logging.INFO)
        repository.set_setting("service_config", serializable_config(values))
        if is_dataclass(config):
            config = replace(config, **values)
            context.config = config
            context.sources.clear()
        return RedirectResponse("/settings", status_code=303)

    @app.post("/settings/path-mappings")
    def save_path_mapping(lidarr_prefix: str = Form(...), consumer_prefix: str = Form(...)):
        repository.set_setting("path_mappings", [[lidarr_prefix, consumer_prefix]])
        return RedirectResponse("/settings", status_code=303)

    @app.post("/settings/test/{service}")
    def test_connection(service: str):
        try:
            if service == "lidarr":
                LidarrClient(config)._request("GET", "system/status")
            elif service in {"spotify", "tidal"}:
                context.source(service).login()
            else:
                raise HTTPException(404, "unknown service")
            message = f"{service.title()} connection successful"
        except HTTPException:
            raise
        except Exception as exc:
            message = f"{service.title()} connection failed: {exc}"
        from urllib.parse import quote

        return RedirectResponse(f"/settings?message={quote(message)}", status_code=303)
