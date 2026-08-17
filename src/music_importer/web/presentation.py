"""Shared template rendering and web view-state derivation."""

from urllib.parse import urlencode

from fastapi import Request
from fastapi.templating import Jinja2Templates

from ..domain.models import AcquiredTrack, PlaylistInfo, SourceTrack
from .context import WebContext


class WebUI:
    def __init__(self, context: WebContext, templates: Jinja2Templates):
        self.context = context
        self.templates = templates

    @property
    def repository(self):
        return self.context.repository

    def render(self, request: Request, template: str, **values):
        imported = values.get("imported")
        if imported is not None:
            entries = self.repository.entries(imported.id)
            states = {entry.resolution_state for entry in entries}
            latest_plan = self.repository.latest_lidarr_plan(imported.id)
            values.setdefault("playlist_track_count", len(entries))
            values.setdefault(
                "can_open_lidarr",
                not bool(
                    states
                    & {"pending", "resolving", "unresolved", "ambiguous", "validation_failed"}
                ),
            )
            values.setdefault("can_open_final", bool(latest_plan))
            values.setdefault(
                "has_unapplied_lidarr_plan", bool(latest_plan and latest_plan[2] != "completed")
            )
            values.setdefault("lidarr_plan_id", latest_plan[0] if latest_plan else None)
        return self.templates.TemplateResponse(
            request,
            template,
            {
                "config": self.context.config,
                "imports": self.repository.list_imports(),
                "csrf_token": getattr(request.state, "csrf_token", ""),
                **values,
            },
        )

    def workflow_step(self, imported, entries=None) -> int:
        entries = entries if entries is not None else self.repository.entries(imported.id)
        states = {entry.resolution_state for entry in entries}
        if states & {"pending", "resolving", "unresolved", "ambiguous", "validation_failed"}:
            return 1
        if imported.workflow_state in {
            "waiting_for_downloads",
            "library_status",
            "playlist_generated",
        }:
            return 3
        return 2

    @staticmethod
    def playlist_info_from_payload(payload: dict) -> PlaylistInfo:
        return PlaylistInfo(**payload)

    @staticmethod
    def acquired_track_from_payload(payload: dict) -> AcquiredTrack:
        track_payload = dict(payload["track"])
        track_payload["artists"] = tuple(track_payload["artists"])
        return AcquiredTrack(
            int(payload["position"]), SourceTrack(**track_payload), payload.get("skip_reason")
        )

    def job_completion_url(self, job) -> str | None:
        if job.import_id and job.kind == "lidarr_planning":
            return f"/imports/{job.import_id}?stage=lidarr"
        if job.import_id and job.kind == "playlist_update_preview":
            return f"/imports/{job.import_id}/update?preview_job={job.id}"
        if job.kind == "playlist_catalogue":
            result = self.repository.job_result(job.id)
            if result and result.get("source"):
                return (
                    f"/imports/new?{urlencode({'source': result['source'], 'catalog_job': job.id})}"
                )
            return None
        return f"/imports/{job.import_id}" if job.import_id else None
