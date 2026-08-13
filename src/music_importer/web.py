from __future__ import annotations

import logging
from dataclasses import dataclass, is_dataclass, replace
from pathlib import Path

import requests
from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import (
    Config,
    apply_stored_config,
    load_config,
    serializable_config,
    service_config_values,
)
from .csv_compat import import_mapping_csv
from .lidarr import LidarrClient
from .m3u import write_m3u
from .models import AcquiredTrack, PlaylistInfo
from .musicbrainz import MusicBrainzClient
from .navidrome import NavidromeClient
from .persistence import ImportRepository
from .playlist_updates import playlist_snapshot_token
from .reports import (
    artist_additions,
    row_for,
    write_artist_impact_report,
    write_lidarr_action_report,
    write_matched_report,
    write_missing_report,
    write_reports,
)
from .services import (
    LibraryStatusService,
    PersistentImportService,
    PlaylistExportService,
    ResolutionProgress,
    ResolutionService,
    library_availability,
)
from .sources.registry import create_source
from .tasks import TaskManager


@dataclass(slots=True)
class WebContext:
    config: Config
    repository: ImportRepository
    tasks: TaskManager
    sources: dict[str, object]

    def source(self, name: str):
        if name not in self.sources:
            self.sources[name] = create_source(name, self.config)
        return self.sources[name]


def create_app(config: Config | None = None, repository: ImportRepository | None = None) -> FastAPI:
    config = config or load_config()
    repository = repository or ImportRepository(config.data_dir / "music-importer.db")
    config = apply_stored_config(config, repository.get_setting("service_config", {}))
    context = WebContext(config, repository, TaskManager(repository), {})
    root = Path(__file__).with_name("web_assets")
    templates = Jinja2Templates(directory=root / "templates")
    app = FastAPI(title="Music Importer")
    app.state.context = context
    app.mount("/static", StaticFiles(directory=root / "static"), name="static")

    @app.get("/health", include_in_schema=False)
    def health():
        return {"status": "ok"}

    def render(request: Request, template: str, **values):
        return templates.TemplateResponse(
            request,
            template,
            {
                "config": context.config,
                "imports": context.repository.list_imports(),
                **values,
            },
        )

    def workflow_step(imported, entries=None) -> int:
        entries = entries if entries is not None else repository.entries(imported.id)
        states = {entry.resolution_state for entry in entries}
        if states & {"pending", "resolving"}:
            return 3
        if states & {"unresolved", "ambiguous", "validation_failed"}:
            return 4
        if imported.workflow_state in {
            "waiting_for_downloads",
            "library_status",
            "playlist_generated",
        }:
            return 6
        return 5

    @app.get("/", response_class=HTMLResponse)
    def dashboard(request: Request):
        items = repository.list_imports()
        jobs = repository.list_jobs(limit=4)
        active_jobs = {
            job.import_id: job
            for job in jobs
            if job.import_id and job.status in {"queued", "running"}
        }
        playlists = []
        for item in items:
            entries = repository.entries(item.id)
            pending = sum(entry.resolution_state in {"pending", "resolving"} for entry in entries)
            review = sum(
                entry.resolution_state in {"unresolved", "ambiguous", "validation_failed"}
                for entry in entries
            )
            resolved = sum(bool(entry.result.resolved_via) for entry in entries)
            if pending:
                next_action = f"Resolve {pending} tracks"
            elif review:
                next_action = f"Review {review} tracks"
            elif item.workflow_state in {"ready_to_plan", "plan_ready"}:
                next_action = "Review Lidarr mapping"
            elif item.workflow_state == "waiting_for_downloads":
                next_action = "Check downloads"
            elif item.workflow_state == "library_status":
                next_action = "Generate playlist"
            elif item.workflow_state == "playlist_generated":
                next_action = "Playlist ready"
            else:
                next_action = item.workflow_state.replace("_", " ").title()
            playlists.append(
                {
                    "imported": item,
                    "tracks": len(entries),
                    "resolved": resolved,
                    "review": review,
                    "next_action": next_action,
                    "job": active_jobs.get(item.id),
                }
            )
        counts = {
            "review": sum(item.workflow_state == "review_required" for item in items),
            "waiting": sum(
                item.workflow_state in {"waiting_for_downloads", "library_status"} for item in items
            ),
            "complete": sum(item.workflow_state == "playlist_generated" for item in items),
        }
        return render(request, "dashboard.html", counts=counts, jobs=jobs, playlists=playlists)

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
        navidrome_url: str = Form(""),
        navidrome_username: str = Form(""),
        navidrome_password: str = Form(""),
        navidrome_root_folder: str = Form(""),
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
            navidrome_url=navidrome_url,
            navidrome_username=navidrome_username,
            navidrome_password=navidrome_password,
            navidrome_root_folder=navidrome_root_folder,
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

    @app.get("/imports/new", response_class=HTMLResponse)
    def new_import(request: Request, source: str | None = None):
        playlists = None
        error = None
        if source:
            try:
                adapter = context.source(source)
                adapter.login()
                playlists = adapter.list_playlists()
            except Exception as exc:
                error = str(exc)
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
            workflow_step=2 if source else 1,
            imported=None,
        )

    @app.post("/imports")
    def create_import(source: str = Form(...), playlist_id: str = Form(...)):
        existing = repository.find_import(source, playlist_id)
        if existing is not None:
            return RedirectResponse(f"/imports/{existing.id}", status_code=303)
        try:
            adapter = context.source(source)
            playlist = adapter.get_playlist(playlist_id)
            imported = PersistentImportService(repository).acquire(adapter, playlist)
        except Exception as exc:
            raise HTTPException(400, str(exc)) from exc
        return RedirectResponse(f"/imports/{imported.id}", status_code=303)

    def current_playlist_entries(imported):
        adapter = context.source(imported.source)
        adapter.login()
        playlist = adapter.get_playlist(imported.source_playlist_id)
        entries = (
            adapter.get_entries(playlist)
            if hasattr(adapter, "get_entries")
            else [
                AcquiredTrack(position, track)
                for position, track in enumerate(adapter.get_tracks(playlist))
            ]
        )
        return playlist, entries

    @app.get("/imports/{import_id}/update", response_class=HTMLResponse)
    def preview_playlist_update(request: Request, import_id: str):
        try:
            imported = repository.get_import(import_id)
            playlist, entries = current_playlist_entries(imported)
            update = repository.preview_playlist_update(import_id, entries)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(400, str(exc)) from exc
        return render(
            request,
            "playlist_update.html",
            imported=imported,
            playlist=playlist,
            update=update,
            entries=entries,
            current_entries=repository.entries(import_id),
            update_token=playlist_snapshot_token(entries),
        )

    @app.post("/imports/{import_id}/update")
    def apply_playlist_update(import_id: str, update_token: str = Form(...)):
        try:
            imported = repository.get_import(import_id)
            if any(
                job.import_id == import_id and job.status in {"queued", "running"}
                for job in repository.list_jobs()
            ):
                raise HTTPException(409, "wait for the active playlist job before updating")
            playlist, entries = current_playlist_entries(imported)
            if update_token != playlist_snapshot_token(entries):
                raise HTTPException(409, "the source playlist changed; preview the update again")
            update = repository.preview_playlist_update(import_id, entries)
            if update.added or update.removed or update.moved:
                repository.apply_playlist_update(import_id, playlist, entries)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(400, str(exc)) from exc
        return RedirectResponse(f"/imports/{import_id}", status_code=303)

    @app.get("/imports/{import_id}/revisions/{revision_id}", response_class=HTMLResponse)
    def playlist_revision(request: Request, import_id: str, revision_id: str):
        try:
            imported = repository.get_import(import_id)
            revision = repository.playlist_revision(import_id, revision_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        return render(request, "playlist_revision.html", imported=imported, revision=revision)

    @app.post("/playlists/{source}/{playlist_id}/analyze")
    def analyze_playlist(source: str, playlist_id: str):
        if not config.lidarr_enabled:
            raise HTTPException(400, "Lidarr is required for impact analysis")
        adapter = context.source(source)
        playlist = adapter.get_playlist(playlist_id)
        if playlist.is_followed:
            repository.save_playlist_analysis(
                source, playlist_id, playlist.name, "skipped_followed", {}
            )
            return RedirectResponse(f"/imports/new?source={source}", status_code=303)

        def operation(job_id: str) -> None:
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

        job = context.tasks.submit("playlist_analysis", operation, total=playlist.track_count or 0)
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

    @app.get("/imports/{import_id}", response_class=HTMLResponse)
    def import_detail(request: Request, import_id: str, stage: str | None = None):
        try:
            imported = repository.get_import(import_id)
            canonical = repository.find_import(imported.source, imported.source_playlist_id)
            if canonical is not None and canonical.id != imported.id:
                return RedirectResponse(f"/imports/{canonical.id}", status_code=307)
            entries = repository.entries(import_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        plan = repository.latest_lidarr_plan(import_id)
        if stage == "lidarr" and plan:
            return RedirectResponse(f"/plans/{plan[0]}", status_code=307)
        library = repository.library_status(import_id)
        execution_context: dict[int, list[dict]] = {}
        if plan and plan[2] in {"completed", "failed"}:
            executed = {
                item["action_position"]: item
                for item in repository.lidarr_execution_results(plan[0])
            }
            for entry in entries:
                relevant = []
                for position, action in enumerate(plan[3].actions):
                    if action.artist_mbid != entry.result.primary_artist_id:
                        continue
                    if (
                        action.release_group_id
                        and action.release_group_id not in entry.result.release_group_ids
                    ):
                        mapped = set((action.payload or {}).get("mapped_release_group_ids", []))
                        if not mapped.intersection(entry.result.release_group_ids):
                            continue
                    requested = set((action.payload or {}).get("requested_recording_ids", []))
                    if requested and not requested.intersection(entry.result.recording_ids):
                        continue
                    outcome = executed.get(position)
                    if outcome:
                        relevant.append(
                            {
                                "action": action.action,
                                "reason": action.reason,
                                "outcome": outcome["outcome"],
                                "details": outcome["details"],
                            }
                        )
                if relevant:
                    execution_context[entry.position] = relevant
        library_availability_by_position = {}
        for position, (classification, path) in library.items():
            availability = library_availability(classification, path)
            if any(
                item.get("reason") in {"various_artists_album", "various_artists_skipped"}
                for item in execution_context.get(position, [])
            ):
                availability = "not_downloadable"
            library_availability_by_position[position] = availability
        library_availability_counts = {
            availability: sum(
                value == availability for value in library_availability_by_position.values()
            )
            for availability in ("downloaded", "downloadable", "not_downloadable")
        }
        resolvable_states = {"pending", "resolving", "unresolved", "ambiguous", "validation_failed"}
        resolvable_count = sum(entry.resolution_state in resolvable_states for entry in entries)
        pending_count = sum(entry.resolution_state in {"pending", "resolving"} for entry in entries)
        review_count = sum(
            entry.resolution_state in {"unresolved", "ambiguous", "validation_failed"}
            for entry in entries
        )
        has_resolvable = resolvable_count > 0
        has_mappings = any(entry.result.resolved_via for entry in entries)
        can_plan = has_mappings and not has_resolvable
        can_refresh = has_mappings and imported.workflow_state in {
            "waiting_for_downloads",
            "library_status",
            "playlist_generated",
        }
        can_generate = has_mappings and imported.workflow_state in {
            "library_status",
            "playlist_generated",
        }
        requested_steps = {"resolve": 3, "review": 4, "lidarr": 5, "export": 6}
        default_step = workflow_step(imported, entries)
        # This route renders the track-resolution review table. A ready Lidarr
        # plan is progress, not a reason to label this page as the plan itself.
        if default_step == 5:
            default_step = 4
        selected_step = requested_steps.get(stage, default_step)
        return render(
            request,
            "import_detail.html",
            imported=imported,
            entries=entries,
            stored_plan=plan,
            library=library,
            latest_export=repository.latest_playlist_export(import_id),
            has_resolvable=has_resolvable,
            resolvable_count=resolvable_count,
            pending_count=pending_count,
            review_count=review_count,
            has_mappings=has_mappings,
            can_plan=can_plan,
            can_refresh=can_refresh,
            can_generate=can_generate,
            workflow_step=selected_step,
            source=imported.source,
            selected_stage=stage,
            lidarr_plan_id=plan[0] if plan else None,
            execution_context=execution_context,
            library_availability=library_availability_by_position,
            library_availability_counts=library_availability_counts,
            revisions=repository.playlist_revisions(import_id),
        )

    @app.post("/imports/{import_id}/resolve")
    def resolve_import(import_id: str):
        repository.get_import(import_id)
        entries = repository.entries(import_id)

        def operation(job_id: str) -> None:
            resolver = MusicBrainzClient(
                config.mb_base_url,
                config.mb_user_agent,
                config.mb_request_delay,
                config.mb_timeout,
                config.mb_max_retries,
            )

            def progress(item: ResolutionProgress) -> None:
                repository.update_job(
                    job_id,
                    current=item.current,
                    total=item.total,
                    current_item=f"{', '.join(item.track.artists)} — {item.track.title}",
                )

            PersistentImportService(repository).resolve(
                import_id, resolver, progress, lambda: repository.get_job(job_id).cancel_requested
            )

        job = context.tasks.submit("resolution", operation, import_id, total=len(entries))
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)

    @app.get("/jobs/{job_id}", response_class=HTMLResponse)
    def job_page(request: Request, job_id: str):
        try:
            job = repository.get_job(job_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        imported = repository.get_import(job.import_id) if job.import_id else None
        completion_url = (
            f"/imports/{job.import_id}?stage=lidarr"
            if job.import_id and job.kind == "lidarr_planning"
            else f"/imports/{job.import_id}"
            if job.import_id
            else None
        )
        return render(
            request,
            "job.html",
            job=job,
            imported=imported,
            source=imported.source if imported else None,
            workflow_step=workflow_step(imported) if imported else None,
            completion_url=completion_url,
        )

    @app.get("/jobs", response_class=HTMLResponse)
    def jobs_page(request: Request):
        jobs = repository.list_jobs()
        queue_positions: dict[str, int] = {}
        position = 0
        for job in jobs:
            if job.status == "queued":
                position += 1
                queue_positions[job.id] = position
        return render(request, "jobs.html", jobs=jobs, queue_positions=queue_positions)

    @app.get("/api/jobs/{job_id}")
    def job_status(job_id: str):
        try:
            job = repository.get_job(job_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        return {
            "id": job.id,
            "import_id": job.import_id,
            "kind": job.kind,
            "status": job.status,
            "current": job.current,
            "total": job.total,
            "current_item": job.current_item,
            "error": job.error,
        }

    @app.post("/jobs/{job_id}/cancel")
    def cancel_job(job_id: str):
        repository.request_job_cancel(job_id)
        return RedirectResponse(f"/jobs/{job_id}", status_code=303)

    def mb_client() -> MusicBrainzClient:
        return MusicBrainzClient(
            config.mb_base_url,
            config.mb_user_agent,
            config.mb_request_delay,
            config.mb_timeout,
            config.mb_max_retries,
        )

    review_states = {"unresolved", "ambiguous", "validation_failed"}

    def review_session_values(entry, active: bool) -> dict:
        queue = [
            item
            for item in repository.entries(entry.import_id)
            if item.resolution_state in review_states
        ]
        index = next((position for position, item in enumerate(queue) if item.id == entry.id), 0)
        return {
            "session": active,
            "session_index": index + 1,
            "session_total": len(queue),
            "previous_entry": queue[index - 1] if active and index > 0 else None,
            "next_entry": queue[index + 1] if active and index + 1 < len(queue) else None,
        }

    def review_redirect(entry, active: bool) -> RedirectResponse:
        if not active:
            return RedirectResponse(f"/imports/{entry.import_id}", status_code=303)
        queue = [
            item
            for item in repository.entries(entry.import_id)
            if item.resolution_state in review_states
        ]
        following = next((item for item in queue if item.position > entry.position), None)
        target = following or (queue[0] if queue else None)
        location = (
            f"/entries/{target.id}/review?session=true" if target else f"/imports/{entry.import_id}"
        )
        return RedirectResponse(location, status_code=303)

    @app.get("/imports/{import_id}/review")
    def start_review_session(import_id: str):
        imported = repository.get_import(import_id)
        queue = [
            item
            for item in repository.entries(imported.id)
            if item.resolution_state in review_states
        ]
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
            workflow_step=4,
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
            workflow_step=4,
            match_suggestions=repository.manual_match_suggestions(entry_id),
            plan_id=plan_id,
            **review_session_values(entry, session),
        )

    @app.post("/entries/{entry_id}/reuse/{source_entry_id}")
    def reuse_manual_match(
        entry_id: int,
        source_entry_id: int,
        session: bool = Form(False),
        plan_id: str | None = Form(None),
    ):
        entry = repository.entry(entry_id)
        suggestions = repository.manual_match_suggestions(entry_id)
        suggestion = next((item for item in suggestions if item.entry.id == source_entry_id), None)
        if suggestion is None:
            raise HTTPException(409, "that manual match is not available for this track")
        source_entry = suggestion.entry
        evidence = dict(source_entry.evidence)
        evidence["reused_from_entry_id"] = source_entry.id
        evidence["reused_from_playlist"] = suggestion.playlist_name
        repository.save_manual_resolution(
            entry_id,
            source_entry.result,
            method="reused_manual",
            validation_status=source_entry.validation_status or "valid",
            evidence=evidence,
            selected_release_group_id=source_entry.selected_release_group_id,
        )
        if plan_id:
            return RedirectResponse(f"/plans/{plan_id}", status_code=303)
        remaining = repository.entries(entry.import_id)
        if not any(
            item.resolution_state
            in {"pending", "resolving", "unresolved", "ambiguous", "validation_failed"}
            for item in remaining
        ):
            repository.set_workflow_state(entry.import_id, "ready_to_plan")
        return review_redirect(entry, session)

    @app.post("/entries/{entry_id}/accept")
    def accept_entry(
        entry_id: int,
        mbid: str = Form(...),
        allow_warning: bool = Form(False),
        release_group_id: str | None = Form(None),
        method: str = Form("manual_mbid"),
        session: bool = Form(False),
        plan_id: str | None = Form(None),
    ):
        entry = repository.entry(entry_id)
        validation = mb_client().validate_recording_mbid(mbid, entry.track)
        if validation.status == "invalid" or validation.candidate is None:
            raise HTTPException(400, "invalid MusicBrainz recording mapping")
        if validation.status == "warning" and not allow_warning:
            raise HTTPException(400, "mapping has warnings and requires explicit confirmation")
        result = validation.candidate.result
        if len(result.release_group_ids) > 1 and not release_group_id:
            raise HTTPException(400, "select a release group for this recording")
        if release_group_id:
            if release_group_id not in result.release_group_ids:
                raise HTTPException(400, "release group is not associated with this recording")
            result = replace(result, release_group_ids=(release_group_id,))
        repository.save_manual_resolution(
            entry_id,
            result,
            method=method,
            validation_status=validation.status,
            evidence=validation.candidate.evidence or {},
            selected_release_group_id=release_group_id,
        )
        if plan_id:
            return RedirectResponse(f"/plans/{plan_id}", status_code=303)
        remaining = repository.entries(entry.import_id)
        if not any(
            item.resolution_state
            in {"pending", "resolving", "unresolved", "ambiguous", "validation_failed"}
            for item in remaining
        ):
            repository.set_workflow_state(entry.import_id, "ready_to_plan")
        return review_redirect(entry, session)

    @app.post("/entries/{entry_id}/retry")
    def retry_entry(entry_id: int, plan_id: str | None = Form(None)):
        entry = repository.entry(entry_id)
        if entry.is_manual:
            if not plan_id:
                raise HTTPException(400, "clear the manual override before retrying automation")
            repository.clear_manual_resolution(entry_id)

        def operation(job_id: str) -> None:
            repository.mark_resolving(entry_id)
            result = mb_client().resolve(entry.track)
            repository.save_automatic_resolution(entry_id, result)
            all_entries = repository.entries(entry.import_id)
            repository.set_workflow_state(
                entry.import_id,
                "review_required"
                if any(
                    item.resolution_state in {"unresolved", "ambiguous", "validation_failed"}
                    for item in all_entries
                )
                else "ready_to_plan",
            )
            repository.update_job(
                job_id,
                current=1,
                total=1,
                current_item=f"{', '.join(entry.track.artists)} — {entry.track.title}",
            )

        job = context.tasks.submit("resolution_retry", operation, entry.import_id, total=1)
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)

    @app.post("/entries/{entry_id}/skip")
    def skip_entry(entry_id: int, session: bool = Form(False), plan_id: str | None = Form(None)):
        entry = repository.entry(entry_id)
        repository.mark_skipped(entry_id)
        remaining = repository.entries(entry.import_id)
        if not any(
            item.resolution_state
            in {"pending", "resolving", "unresolved", "ambiguous", "validation_failed"}
            for item in remaining
        ):
            repository.set_workflow_state(entry.import_id, "ready_to_plan")
        if plan_id:
            return RedirectResponse(f"/plans/{plan_id}", status_code=303)
        return review_redirect(entry, session)

    @app.post("/entries/{entry_id}/clear-override")
    def clear_override(entry_id: int):
        entry = repository.entry(entry_id)
        repository.clear_manual_resolution(entry_id)
        repository.set_workflow_state(entry.import_id, "review_required")
        return RedirectResponse(f"/imports/{entry.import_id}", status_code=303)

    def submit_lidarr_plan(import_id: str):
        if not config.lidarr_enabled:
            raise HTTPException(400, "Lidarr is not configured")
        entries = repository.entries(import_id)
        blockers = {"pending", "resolving", "unresolved", "ambiguous", "validation_failed"}
        if any(entry.resolution_state in blockers for entry in entries):
            raise HTTPException(409, "resolve, manually match, or skip every review item first")
        if not any(entry.result.resolved_via for entry in entries):
            raise HTTPException(409, "there are no resolved tracks to plan")

        artist_count = len(
            {entry.result.primary_artist_id for entry in entries if entry.result.primary_artist_id}
        )

        def operation(job_id: str) -> None:
            def progress(current: int, total: int, item: str) -> None:
                repository.update_job(job_id, current=current, total=total, current_item=item)

            try:
                plan = LidarrClient(config).plan(
                    [entry.result for entry in entries],
                    progress,
                    {
                        recording_id
                        for entry in entries
                        if entry.evidence.get("allow_various_artists_release")
                        for recording_id in entry.result.recording_ids
                    },
                )
            except requests.Timeout as exc:
                raise RuntimeError(
                    f"{exc}. Lidarr is reachable, but this request did not complete; "
                    "retry the plan."
                ) from exc
            repository.save_lidarr_plan(import_id, plan)
            repository.update_job(job_id, current=len(plan.actions), total=len(plan.actions))

        return context.tasks.submit("lidarr_planning", operation, import_id, total=artist_count + 1)

    @app.post("/imports/{import_id}/plan")
    def plan_lidarr(import_id: str):
        job = submit_lidarr_plan(import_id)
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)

    @app.post("/plans/{plan_id}/entries/{entry_id}/release")
    def change_plan_release(plan_id: str, entry_id: int, release_group_id: str = Form(...)):
        import_id, status, _ = repository.get_lidarr_plan(plan_id)
        if status not in {"draft", "superseded"}:
            raise HTTPException(409, "an applied plan cannot be edited")
        entry = repository.entry(entry_id)
        if entry.import_id != import_id:
            raise HTTPException(409, "track does not belong to this plan")
        if release_group_id not in entry.result.release_group_ids:
            raise HTTPException(400, "release group is not associated with this recording")
        repository.save_manual_resolution(
            entry_id,
            replace(entry.result, release_group_ids=(release_group_id,)),
            method="reused_manual" if entry.resolution_method == "reused_manual" else "manual_mbid",
            validation_status=entry.validation_status or "valid",
            evidence=entry.evidence,
            selected_release_group_id=release_group_id,
        )
        return RedirectResponse(f"/plans/{plan_id}", status_code=303)

    @app.post("/plans/{plan_id}/entries/{entry_id}/allow-va")
    def allow_various_artists_release(plan_id: str, entry_id: int):
        import_id, status, _ = repository.get_lidarr_plan(plan_id)
        if status not in {"draft", "superseded"}:
            raise HTTPException(409, "an applied plan cannot be edited")
        entry = repository.entry(entry_id)
        if entry.import_id != import_id:
            raise HTTPException(409, "track does not belong to this plan")
        repository.set_various_artists_override(entry_id, True)
        return RedirectResponse(f"/plans/{plan_id}", status_code=303)

    @app.get("/plans/{plan_id}", response_class=HTMLResponse)
    def plan_detail(request: Request, plan_id: str):
        try:
            import_id, status, plan = repository.get_lidarr_plan(plan_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        artist_ids = {action.artist_mbid for action in plan.actions if action.artist_mbid}
        release_ids = {
            action.release_group_id for action in plan.actions if action.release_group_id
        }
        summary = {
            "artists": len(artist_ids),
            "new_artists": sum(action.action == "create_artist" for action in plan.actions),
            "releases": len(release_ids),
            "represented": sum(
                action.action in {"reuse_downloaded_release", "reuse_existing_release", "unchanged"}
                for action in plan.actions
            ),
            "monitored": sum(action.action == "monitor_release" for action in plan.actions),
            "searches": sum(action.action == "queue_search" for action in plan.actions),
            "attention": sum(action.action == "skip" for action in plan.actions),
        }
        imported = repository.get_import(import_id)
        entries = repository.entries(import_id)
        actions_by_group: dict[str, list] = {}
        actions_by_artist: dict[str, list] = {}
        reuse_by_source_group: dict[str, list] = {}
        for action in plan.actions:
            if action.release_group_id:
                actions_by_group.setdefault(action.release_group_id, []).append(action)
            elif action.artist_mbid:
                actions_by_artist.setdefault(action.artist_mbid, []).append(action)
            if action.action == "reuse_downloaded_release":
                for original in (action.payload or {}).get("mapped_release_group_ids", []):
                    reuse_by_source_group.setdefault(original, []).append(action)
        track_links = []
        mutating_action_names = {
            "create_artist",
            "create_release",
            "monitor_artist",
            "monitor_release",
            "queue_search",
        }
        for entry in entries:
            releases = []
            for original_group in entry.result.release_group_ids:
                reuse_action = next(
                    (
                        action
                        for action in reuse_by_source_group.get(original_group, [])
                        if set(
                            (action.payload or {}).get("requested_recording_ids", [])
                        ).intersection(entry.result.recording_ids)
                    ),
                    None,
                )
                lidarr_group = reuse_action.release_group_id if reuse_action else original_group
                actions = []
                for action in actions_by_group.get(lidarr_group, []):
                    if action.artist_mbid and action.artist_mbid != entry.result.primary_artist_id:
                        continue
                    requested_recordings = set(
                        (action.payload or {}).get("requested_recording_ids", [])
                    )
                    if requested_recordings and not requested_recordings.intersection(
                        entry.result.recording_ids
                    ):
                        continue
                    actions.append(action)
                displayed_reuse = next(
                    (action for action in actions if action.action == "reuse_downloaded_release"),
                    None,
                )
                release_artist = next(
                    (action for action in actions if action.artist_name or action.artist_mbid), None
                )
                releases.append(
                    {
                        "source_group": original_group,
                        "lidarr_group": lidarr_group,
                        "title": next(
                            (action.album_title for action in actions if action.album_title), ""
                        ),
                        "artist_name": (
                            release_artist.artist_name
                            if release_artist
                            else next(iter(entry.result.artist_names), "")
                        ),
                        "artist_mbid": (
                            release_artist.artist_mbid
                            if release_artist
                            else entry.result.primary_artist_id or ""
                        ),
                        "actions": actions,
                        "matched_track": (
                            (displayed_reuse.payload or {}).get("matched_track")
                            if displayed_reuse
                            else None
                        ),
                        "lidarr_album_id": (
                            (displayed_reuse.payload or {}).get("lidarr_album_id")
                            if displayed_reuse
                            else None
                        ),
                    }
                )
            artist_actions = list(actions_by_artist.get(entry.result.primary_artist_id or "", []))
            linked_actions = list(artist_actions)
            seen_action_names = set()
            seen_action_names.update(action.action for action in artist_actions)
            for release in releases:
                for action in release["actions"]:
                    if action.action not in seen_action_names:
                        seen_action_names.add(action.action)
                        linked_actions.append(action)
            if not linked_actions and not entry.result.resolved_via:
                seen_action_names.add("skip")
            track_links.append(
                {
                    "entry": entry,
                    "releases": releases,
                    "actions": linked_actions,
                    "artist_action_names": {action.action for action in artist_actions},
                    "action_names": sorted(seen_action_names),
                    "mutates": bool(seen_action_names & mutating_action_names),
                    "various_artists_skip": any(
                        action.reason in {"various_artists_album", "various_artists_skipped"}
                        for action in linked_actions
                    ),
                    "various_artists_override": bool(
                        entry.evidence.get("allow_various_artists_release")
                    ),
                }
            )
        action_guide = [
            (
                "unchanged",
                "No change",
                "The selected release is already represented and configured in Lidarr.",
            ),
            (
                "reuse_downloaded_release",
                "Reuse downloaded release",
                "Bind the song to the release whose downloaded file already contains this recording; no Lidarr mutation by itself.",
            ),
            (
                "reuse_existing_release",
                "Reuse existing release",
                "Use an album already present in Lidarr; no duplicate album is created.",
            ),
            (
                "create_artist",
                "Create artist",
                "Add the MusicBrainz artist to Lidarr, initially without monitoring unrelated releases.",
            ),
            (
                "create_release",
                "Create release",
                "Add this specific MusicBrainz album, EP, or single to Lidarr.",
            ),
            (
                "monitor_artist",
                "Monitor artist",
                "Monitor the artist while keeping new-item monitoring disabled.",
            ),
            (
                "monitor_release",
                "Monitor release",
                "Turn monitoring on only when a requested recording is missing and must be acquired.",
            ),
            (
                "queue_search",
                "Queue search",
                "Ask Lidarr to search its indexers for the selected release.",
            ),
            (
                "skip",
                "Skip",
                "Make no Lidarr change because the binding is unresolved or excluded by a safety rule.",
            ),
        ]
        reason_guide = {
            "musicbrainz_unresolved": "No validated MusicBrainz recording is bound to this song.",
            "release_group_unresolved": "The recording has no selected MusicBrainz release group.",
            "various_artists_skipped": "Various Artists is excluded to avoid adding or broadly monitoring compilation artists.",
            "various_artists_album": "This release is a Various Artists compilation and is excluded by the Lidarr safety policy.",
            "artist_missing": "The artist is not yet present in Lidarr.",
            "release_missing": "This specific release is not yet present in Lidarr.",
            "requested_release": "This is the release selected for a missing playlist song.",
            "requested_track_missing": "The selected recording is not downloaded in Lidarr.",
            "downloaded_recording_match": "Lidarr already has this recording on the named release.",
            "release_exists_globally": "The release already exists elsewhere in the Lidarr library.",
            "already_monitored": "The release is already monitored; no configuration change is needed.",
            "already_downloaded_and_monitored": "The recording is downloaded and the release is already monitored.",
            "requested_recording_downloaded": "The requested recording file already exists; monitoring is not changed.",
            "monitored_with_new_items_disabled": "Monitor this artist only for explicitly selected releases; automatic new-release monitoring remains disabled.",
        }
        return render(
            request,
            "lidarr_plan.html",
            plan_id=plan_id,
            import_id=import_id,
            plan_status=status,
            plan=plan,
            summary=summary,
            execution=repository.lidarr_execution_results(plan_id),
            imported=imported,
            source=imported.source,
            workflow_step=5,
            track_links=track_links,
            action_guide=action_guide,
            reason_guide=reason_guide,
            lidarr_plan_id=plan_id,
        )

    @app.post("/plans/{plan_id}/execute")
    def execute_lidarr_plan(plan_id: str):
        import_id, _, plan = repository.get_lidarr_plan(plan_id)
        try:
            repository.approve_lidarr_plan(plan_id)
        except ValueError as exc:
            raise HTTPException(
                409, "this plan was replaced after a binding changed; open the latest plan"
            ) from exc

        def operation(job_id: str) -> None:
            def progress(current: int, total: int, item: str) -> None:
                repository.update_job(job_id, current=current, total=total, current_item=item)

            execution = LidarrClient(config).execute_plan(plan, progress)
            repository.record_lidarr_execution(plan_id, execution)

        job = context.tasks.submit(
            "lidarr_execution", operation, import_id, total=len(plan.actions)
        )
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)

    @app.post("/imports/{import_id}/library-status")
    def refresh_library_status(import_id: str):
        if not config.lidarr_enabled:
            raise HTTPException(400, "Lidarr is not configured")
        entries = repository.entries(import_id)
        imported = repository.get_import(import_id)
        if imported.workflow_state not in {
            "waiting_for_downloads",
            "library_status",
            "playlist_generated",
        }:
            raise HTTPException(409, "apply a Lidarr plan before refreshing downloads")
        if not any(entry.result.resolved_via for entry in entries):
            raise HTTPException(409, "there are no resolved tracks to check")

        def operation(job_id: str) -> None:
            def progress(current: int, total: int, item: str) -> None:
                repository.update_job(job_id, current=current, total=total, current_item=item)

            statuses = LibraryStatusService(LidarrClient(config)).refresh(
                [entry.result for entry in entries], progress
            )
            repository.save_library_status(import_id, statuses)

        artist_count = len(
            {entry.result.primary_artist_id for entry in entries if entry.result.primary_artist_id}
        )
        job = context.tasks.submit(
            "library_status", operation, import_id, total=2 + artist_count * 2
        )
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)

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
            navidrome = NavidromeClient(config) if config.navidrome_enabled else None
            export = PlaylistExportService(LidarrClient(config), navidrome).build(
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
                export.navidrome_matches,
            )
            repository.update_job(job_id, current=len(entries), total=len(entries))

        job = context.tasks.submit("playlist_generation", operation, import_id, total=len(entries))
        return RedirectResponse(f"/jobs/{job.id}", status_code=303)

    @app.get("/imports/{import_id}/export/{kind}")
    def export_report(import_id: str, kind: str):
        imported = repository.get_import(import_id)
        entries = repository.entries(import_id)
        playlist = PlaylistInfo(
            imported.source,
            imported.source_playlist_id,
            imported.playlist_name,
            imported.playlist_path,
        )
        rows = [row_for(playlist, entry.track, entry.result) for entry in entries]
        mapping, unresolved = write_reports(config.output_dir, playlist, rows)
        if kind == "mapping":
            path = mapping
        elif kind == "unresolved":
            path = unresolved
        elif kind in {"missing", "matched", "artist-impact"}:
            if not config.lidarr_enabled:
                raise HTTPException(400, "Lidarr is not configured")
            missing, matched = LidarrClient(config).compare([entry.result for entry in entries])
            if kind == "missing":
                path = write_missing_report(config.output_dir, playlist, rows, missing)
            elif kind == "matched":
                path = write_matched_report(config.output_dir, playlist, rows, matched)
            else:
                path = write_artist_impact_report(
                    mapping, artist_additions([entry.result for entry in entries], missing)
                )
        elif kind == "lidarr-actions":
            stored = repository.latest_lidarr_plan(import_id)
            if not stored:
                raise HTTPException(400, "create a Lidarr plan before exporting actions")
            plan = stored[3]
            action_rows = [
                {
                    "mapped_artist_names": action.artist_name,
                    "artist_name": action.artist_name,
                    "artist_mbid": action.artist_mbid,
                    "artist_lidarr_url": (
                        f"{config.lidarr_url}/artist/{action.artist_mbid}"
                        if config.lidarr_url and action.artist_mbid
                        else ""
                    ),
                    "release_group_id": action.release_group_id,
                    "album_title": action.album_title,
                    "album_lidarr_url": (
                        f"{config.lidarr_url}/album/{action.release_group_id}"
                        if config.lidarr_url and action.release_group_id
                        else ""
                    ),
                    "action": action.action,
                    "outcome": "planned",
                    "details": action.reason,
                }
                for action in plan.actions
            ]
            path = write_lidarr_action_report(mapping, action_rows)
        else:
            raise HTTPException(404, "unknown report type")
        return FileResponse(path, filename=path.name, media_type="text/csv")

    @app.post("/settings/test/{service}")
    def test_connection(service: str):
        try:
            if service == "lidarr":
                LidarrClient(config)._request("GET", "system/status")
            elif service == "navidrome":
                NavidromeClient(config)._request("ping.view")
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

    return app
