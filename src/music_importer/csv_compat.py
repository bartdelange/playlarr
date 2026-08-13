"""Compatibility import for mapping reports produced by the legacy CLI."""

from pathlib import Path

from .models import PlaylistInfo, SourceTrack
from .persistence import ImportRepository, StoredImport
from .reports import load_mapping_report


def import_mapping_csv(
    path: Path, repository: ImportRepository, playlist_name: str | None = None
) -> StoredImport:
    results, rows, _ = load_mapping_report(path)
    if not rows:
        raise ValueError("cannot infer source playlist metadata from an empty mapping CSV")
    first = rows[0]
    source = (first.get("source") or "unknown").strip()
    playlist_id = (first.get("source_playlist_id") or "").strip()
    if not playlist_id:
        raise ValueError("mapping CSV has no source playlist ID")
    imported = repository.create_import(
        PlaylistInfo(source, playlist_id, playlist_name or path.stem),
        metadata={"imported_from_csv": str(path)},
    )
    tracks = [
        SourceTrack(
            source=source,
            source_track_id=(row.get("source_track_id") or f"csv:{position}"),
            title=row.get("track_title") or "",
            artists=tuple(
                value.strip() for value in (row.get("artists") or "").split(";") if value.strip()
            ),
            album=row.get("album") or "",
            isrc=row.get("isrc") or None,
            duration_ms=(
                int(row["duration_ms"]) if (row.get("duration_ms") or "").isdigit() else None
            ),
        )
        for position, row in enumerate(rows)
    ]
    repository.replace_tracks(imported.id, tracks)
    entries = repository.entries(imported.id)
    for entry, result in zip(entries, results):
        repository.save_imported_resolution(entry.id, result)
    repository.set_workflow_state(
        imported.id,
        "review_required"
        if any(not result.resolved_via for result in results)
        else "ready_to_plan",
    )
    return repository.get_import(imported.id)
