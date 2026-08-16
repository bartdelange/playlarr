"""FastAPI application composition."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from ..application.tasks import TaskManager
from ..config import Config, apply_stored_config, load_config
from ..persistence import ImportRepository
from .context import WebContext
from .presentation import WebUI
from .routes import (
    catalogue,
    dashboard,
    import_deletion,
    imports,
    jobs,
    lidarr,
    lidarr_execution,
    lidarr_plan_detail,
    mapping_overrides,
    playlist_export,
    playlist_updates,
    review,
    review_actions,
    settings,
)


def create_app(config: Config | None = None, repository: ImportRepository | None = None) -> FastAPI:
    config = config or load_config()
    repository = repository or ImportRepository(config.data_dir / "music-importer.db")
    config = apply_stored_config(config, repository.get_setting("service_config", {}))
    context = WebContext(config, repository, TaskManager(repository), {})
    assets = Path(__file__).parent
    ui = WebUI(context, Jinja2Templates(directory=assets / "templates"))

    app = FastAPI(title="Music Importer")
    app.state.context = context
    app.mount("/static", StaticFiles(directory=assets / "static"), name="static")
    for routes in (
        dashboard,
        settings,
        catalogue,
        mapping_overrides,
        playlist_updates,
        imports,
        import_deletion,
        jobs,
        review,
        review_actions,
        lidarr,
        lidarr_plan_detail,
        lidarr_execution,
        playlist_export,
    ):
        routes.register_routes(app, ui)
    return app
