from __future__ import annotations

from dataclasses import is_dataclass, replace

from fastapi import FastAPI, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from ...config import serializable_config, service_config_values
from ...integrations.lidarr import LidarrClient
from ...integrations.navidrome import NavidromeClient
from ...integrations.sources.spotify import SpotifySource
from ...integrations.sources.tidal import TidalSource
from ..presentation import WebUI


def register_routes(app: FastAPI, ui: WebUI) -> None:
    context = ui.context
    repository = context.repository
    config = context.config
    render = ui.render

    @app.get("/settings", response_class=HTMLResponse)
    def settings(request: Request, message: str | None = None):
        lidarr_configured = bool(config.lidarr_url and config.lidarr_api_key)
        root_folders: list[tuple[str, str]] = []
        quality_profiles: list[tuple[int, str]] = []
        metadata_profiles: list[tuple[int, str]] = []
        lidarr_options_error = None
        if lidarr_configured:
            try:
                lidarr = LidarrClient(config)
                root_folders = lidarr.root_folders()
                quality_profiles = lidarr.quality_profiles()
                metadata_profiles = lidarr.metadata_profiles()
            except Exception as exc:
                lidarr_options_error = f"Could not load Lidarr options: {exc}"

        return render(
            request,
            "settings.html",
            path_mappings=repository.get_setting(
                "path_mappings", [[config.lidarr_root_folder, config.lidarr_root_folder]]
            ),
            lidarr_configured=lidarr_configured,
            lidarr_options_error=lidarr_options_error,
            root_folders=root_folders,
            quality_profiles=quality_profiles,
            metadata_profiles=metadata_profiles,
            message=message,
        )

    @app.post("/settings/services/{service}")
    def save_services(
        service: str,
        mb_user_agent: str | None = Form(None),
        spotify_client_id: str | None = Form(None),
        spotify_redirect_uri: str | None = Form(None),
        lidarr_url: str | None = Form(None),
        lidarr_api_key: str | None = Form(None),
        lidarr_root_folder: str | None = Form(None),
        lidarr_quality_profile_id: int | None = Form(None),
        lidarr_metadata_profile_id: int | None = Form(None),
        navidrome_url: str | None = Form(None),
        navidrome_username: str | None = Form(None),
        navidrome_password: str | None = Form(None),
    ):
        nonlocal config
        expected_fields = {
            "musicbrainz": {"mb_user_agent"},
            "spotify": {"spotify_client_id", "spotify_redirect_uri"},
            "lidarr": {
                "lidarr_url",
                "lidarr_api_key",
                "lidarr_root_folder",
                "lidarr_quality_profile_id",
                "lidarr_metadata_profile_id",
            },
            "navidrome": {"navidrome_url", "navidrome_username", "navidrome_password"},
        }
        if service not in expected_fields:
            raise HTTPException(404, "unknown service settings")
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
            navidrome_url=navidrome_url,
            navidrome_username=navidrome_username,
            navidrome_password=navidrome_password,
        )
        if set(values) != expected_fields[service]:
            raise HTTPException(400, "invalid service settings")
        stored = previous.copy() if isinstance(previous, dict) else {}
        stored.pop("output_dir", None)
        stored.update(serializable_config(values))
        repository.set_setting("service_config", stored)
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
            elif service == "navidrome":
                NavidromeClient(config).search_songs("", limit=1)
            elif service in {"spotify", "tidal"}:
                raise HTTPException(400, f"use Authenticate {service.title()}")
            else:
                raise HTTPException(404, "unknown service")
            message = f"{service.title()} connection successful"
        except HTTPException:
            raise
        except Exception as exc:
            message = f"{service.title()} connection failed: {exc}"
        from urllib.parse import quote

        return RedirectResponse(f"/settings?message={quote(message)}", status_code=303)

    @app.post("/settings/auth/tidal", response_class=HTMLResponse)
    def authenticate_tidal(request: Request):
        source = context.source("tidal")
        if not isinstance(source, TidalSource):
            raise HTTPException(500, "TIDAL source is not available")
        return render(request, "tidal_auth.html", authorization_url=source.authorization_url())

    @app.get("/api/settings/auth/tidal")
    def tidal_authentication_status():
        source = context.source("tidal")
        if not isinstance(source, TidalSource):
            raise HTTPException(500, "TIDAL source is not available")
        status, error = source.authorization_status()
        return {"status": status, "error": error}

    @app.post("/settings/auth/spotify")
    def authenticate_spotify():
        source = context.source("spotify")
        if not isinstance(source, SpotifySource):
            raise HTTPException(500, "Spotify source is not available")
        try:
            return RedirectResponse(source.authorization_url(), status_code=303)
        except Exception as exc:
            from urllib.parse import quote

            return RedirectResponse(
                f"/settings?message={quote(f'Spotify authentication failed: {exc}')}",
                status_code=303,
            )

    @app.get("/callback")
    def spotify_callback(code: str = Query(""), state: str = Query(""), error: str = Query("")):
        from urllib.parse import quote

        try:
            if error:
                raise ValueError(error)
            if not code or not state:
                raise ValueError("Spotify did not return an authorization code")
            source = context.source("spotify")
            if not isinstance(source, SpotifySource):
                raise ValueError("Spotify source is not available")
            source.complete_authorization(code, state)
            message = "Spotify connection successful"
        except Exception as exc:
            message = f"Spotify authentication failed: {exc}"
        return RedirectResponse(f"/settings?message={quote(message)}", status_code=303)
