"""SQLite persistence for resumable GUI imports.

The schema uses only the standard library and is migrated through SQLite's
``user_version``. CSV remains an interchange format, never primary state.
"""

import json
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from .models import (
    AcquiredTrack,
    LidarrPlan,
    LidarrPlanAction,
    MusicBrainzCandidate,
    MusicBrainzResult,
    PlaylistInfo,
    SourceTrack,
)

SCHEMA_VERSION = 5
RESOLUTION_STATES = {
    "pending",
    "resolving",
    "automatically_resolved",
    "manually_resolved",
    "ambiguous",
    "unresolved",
    "skipped",
    "validation_failed",
}


def _now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True, slots=True)
class StoredImport:
    id: str
    source: str
    source_playlist_id: str
    playlist_name: str
    playlist_path: str | None
    workflow_state: str
    created_at: str
    updated_at: str
    last_error: str | None = None


@dataclass(frozen=True, slots=True)
class StoredEntry:
    id: int
    import_id: str
    position: int
    track: SourceTrack
    resolution_state: str
    result: MusicBrainzResult
    resolution_method: str | None
    evidence: dict
    is_manual: bool
    validation_status: str | None
    selected_release_group_id: str | None


@dataclass(frozen=True, slots=True)
class StoredJob:
    id: str
    import_id: str | None
    kind: str
    status: str
    current: int
    total: int
    current_item: str | None
    cancel_requested: bool
    error: str | None


@dataclass(frozen=True, slots=True)
class ManualMatchSuggestion:
    entry: StoredEntry
    playlist_name: str


@dataclass(frozen=True, slots=True)
class PlaylistUpdate:
    added: int
    removed: int
    moved: int
    unchanged: int


@dataclass(frozen=True, slots=True)
class PlaylistRevision:
    id: str
    created_at: str
    added: int
    removed: int
    moved: int
    unchanged: int


class ImportRepository:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate()
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    def settings(self) -> dict[str, object]:
        with self.connect() as db:
            rows = db.execute("SELECT key, value_json FROM settings").fetchall()
        return {row["key"]: json.loads(row["value_json"]) for row in rows}

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _migrate(self) -> None:
        with self.connect() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > SCHEMA_VERSION:
                raise RuntimeError(
                    f"database schema {version} is newer than supported {SCHEMA_VERSION}"
                )
            if version < 1:
                db.executescript("""
                    CREATE TABLE imports (
                        id TEXT PRIMARY KEY,
                        source TEXT NOT NULL,
                        source_playlist_id TEXT NOT NULL,
                        playlist_name TEXT NOT NULL,
                        playlist_path TEXT,
                        playlist_metadata_json TEXT NOT NULL DEFAULT '{}',
                        workflow_state TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        last_error TEXT
                    );
                    CREATE INDEX imports_updated ON imports(updated_at DESC);
                    CREATE TABLE playlist_entries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
                        position INTEGER NOT NULL,
                        source_track_id TEXT NOT NULL,
                        title TEXT NOT NULL,
                        artists_json TEXT NOT NULL,
                        album TEXT NOT NULL,
                        duration_ms INTEGER,
                        isrc TEXT,
                        acquisition_status TEXT NOT NULL DEFAULT 'acquired',
                        skip_reason TEXT,
                        UNIQUE(import_id, position)
                    );
                    CREATE TABLE resolutions (
                        entry_id INTEGER PRIMARY KEY REFERENCES playlist_entries(id) ON DELETE CASCADE,
                        state TEXT NOT NULL,
                        method TEXT,
                        result_json TEXT NOT NULL DEFAULT '{}',
                        evidence_json TEXT NOT NULL DEFAULT '{}',
                        is_manual INTEGER NOT NULL DEFAULT 0,
                        validation_status TEXT,
                        selected_release_group_id TEXT,
                        confirmed_at TEXT,
                        updated_at TEXT NOT NULL
                    );
                    CREATE TABLE lidarr_plans (
                        id TEXT PRIMARY KEY,
                        import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
                        status TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        approved_at TEXT
                    );
                    CREATE TABLE lidarr_plan_actions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        plan_id TEXT NOT NULL REFERENCES lidarr_plans(id) ON DELETE CASCADE,
                        position INTEGER NOT NULL,
                        action_json TEXT NOT NULL,
                        UNIQUE(plan_id, position)
                    );
                    CREATE TABLE lidarr_execution_results (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        plan_id TEXT NOT NULL REFERENCES lidarr_plans(id) ON DELETE CASCADE,
                        action_position INTEGER NOT NULL,
                        attempted_at TEXT NOT NULL,
                        outcome TEXT NOT NULL,
                        details TEXT NOT NULL DEFAULT ''
                    );
                    CREATE TABLE jobs (
                        id TEXT PRIMARY KEY,
                        import_id TEXT REFERENCES imports(id) ON DELETE CASCADE,
                        kind TEXT NOT NULL,
                        status TEXT NOT NULL,
                        current INTEGER NOT NULL DEFAULT 0,
                        total INTEGER NOT NULL DEFAULT 0,
                        current_item TEXT,
                        cancel_requested INTEGER NOT NULL DEFAULT 0,
                        error TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                    CREATE TABLE settings (
                        key TEXT PRIMARY KEY,
                        value_json TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                    CREATE TABLE playlist_exports (
                        id TEXT PRIMARY KEY,
                        import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
                        output_path TEXT NOT NULL,
                        written_tracks INTEGER NOT NULL,
                        missing_tracks INTEGER NOT NULL,
                        navidrome_matches INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL
                    );
                    PRAGMA user_version = 1;
                """)
                version = 1
            if version < 2:
                db.executescript("""
                    CREATE TABLE resolution_candidates (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        entry_id INTEGER NOT NULL REFERENCES playlist_entries(id) ON DELETE CASCADE,
                        position INTEGER NOT NULL,
                        candidate_json TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        UNIQUE(entry_id, position)
                    );
                    PRAGMA user_version = 2;
                """)
                version = 2
            if version < 3:
                db.executescript("""
                    CREATE TABLE library_status (
                        entry_id INTEGER PRIMARY KEY REFERENCES playlist_entries(id) ON DELETE CASCADE,
                        classification TEXT NOT NULL,
                        file_path TEXT,
                        refreshed_at TEXT NOT NULL
                    );
                    PRAGMA user_version = 3;
                """)
                version = 3
            if version < 4:
                db.executescript("""
                    CREATE TABLE playlist_analyses (
                        source TEXT NOT NULL,
                        playlist_id TEXT NOT NULL,
                        playlist_name TEXT NOT NULL,
                        status TEXT NOT NULL,
                        result_json TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY(source, playlist_id)
                    );
                    PRAGMA user_version = 4;
                """)
                version = 4
            if version < 5:
                db.executescript("""
                    CREATE TABLE playlist_revisions (
                        id TEXT PRIMARY KEY,
                        import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
                        created_at TEXT NOT NULL,
                        before_json TEXT NOT NULL,
                        after_json TEXT NOT NULL,
                        added INTEGER NOT NULL,
                        removed INTEGER NOT NULL,
                        moved INTEGER NOT NULL,
                        unchanged INTEGER NOT NULL
                    );
                    CREATE INDEX playlist_revisions_import
                        ON playlist_revisions(import_id, created_at DESC);
                    PRAGMA user_version = 5;
                """)
            db.execute(
                "UPDATE jobs SET status = 'interrupted', updated_at = ? WHERE status = 'running'",
                (_now(),),
            )

    def create_import(
        self, playlist: PlaylistInfo, *, metadata: dict | None = None, import_id: str | None = None
    ) -> StoredImport:
        identifier = import_id or str(uuid.uuid4())
        timestamp = _now()
        with self.connect() as db:
            db.execute(
                """INSERT INTO imports
                (id, source, source_playlist_id, playlist_name, playlist_path,
                 playlist_metadata_json, workflow_state, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'acquiring', ?, ?)""",
                (
                    identifier,
                    playlist.source,
                    playlist.id,
                    playlist.name,
                    playlist.path,
                    json.dumps(metadata or {}),
                    timestamp,
                    timestamp,
                ),
            )
        return self.get_import(identifier)

    def get_import(self, import_id: str) -> StoredImport:
        with self.connect() as db:
            row = db.execute("SELECT * FROM imports WHERE id = ?", (import_id,)).fetchone()
        if row is None:
            raise KeyError(f"unknown import: {import_id}")
        return StoredImport(
            row["id"],
            row["source"],
            row["source_playlist_id"],
            row["playlist_name"],
            row["playlist_path"],
            row["workflow_state"],
            row["created_at"],
            row["updated_at"],
            row["last_error"],
        )

    def list_imports(self) -> list[StoredImport]:
        with self.connect() as db:
            ids = [row[0] for row in db.execute("SELECT id FROM imports ORDER BY updated_at DESC")]
        imports = [self.get_import(identifier) for identifier in ids]
        canonical: dict[tuple[str, str], StoredImport] = {}
        rank = {
            "playlist_generated": 100,
            "library_status": 90,
            "waiting_for_downloads": 80,
            "execution_failed": 75,
            "plan_ready": 70,
            "ready_to_plan": 60,
            "review_required": 50,
            "resolution_interrupted": 45,
            "resolving": 40,
            "ready_to_resolve": 30,
            "acquiring": 20,
        }
        for imported in imports:
            key = (imported.source, imported.source_playlist_id)
            current = canonical.get(key)
            if current is None or rank.get(imported.workflow_state, 0) > rank.get(
                current.workflow_state, 0
            ):
                canonical[key] = imported
        return sorted(canonical.values(), key=lambda item: item.updated_at, reverse=True)

    def find_import(self, source: str, source_playlist_id: str) -> StoredImport | None:
        """Return the canonical import for a source playlist, if it was imported before."""
        return next(
            (
                item
                for item in self.list_imports()
                if item.source == source and item.source_playlist_id == source_playlist_id
            ),
            None,
        )

    def set_workflow_state(self, import_id: str, state: str, error: str | None = None) -> None:
        with self.connect() as db:
            db.execute(
                "UPDATE imports SET workflow_state = ?, last_error = ?, updated_at = ? WHERE id = ?",
                (state, error, _now(), import_id),
            )

    def replace_tracks(self, import_id: str, tracks: list[SourceTrack]) -> None:
        self.replace_acquired_tracks(
            import_id, [AcquiredTrack(position, track) for position, track in enumerate(tracks)]
        )

    def replace_acquired_tracks(self, import_id: str, entries: list[AcquiredTrack]) -> None:
        with self.connect() as db:
            db.execute("DELETE FROM playlist_entries WHERE import_id = ?", (import_id,))
            for acquired in entries:
                position, track = acquired.position, acquired.track
                cursor = db.execute(
                    """INSERT INTO playlist_entries
                    (import_id, position, source_track_id, title, artists_json, album, isrc,
                     duration_ms, acquisition_status, skip_reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        import_id,
                        position,
                        track.source_track_id,
                        track.title,
                        json.dumps(track.artists),
                        track.album,
                        track.isrc,
                        track.duration_ms,
                        "skipped" if acquired.skip_reason else "acquired",
                        acquired.skip_reason,
                    ),
                )
                db.execute(
                    """INSERT INTO resolutions
                    (entry_id, state, method, result_json, evidence_json, updated_at)
                    VALUES (?, ?, ?, '{}', ?, ?)""",
                    (
                        cursor.lastrowid,
                        "skipped" if acquired.skip_reason else "pending",
                        "source_skip" if acquired.skip_reason else None,
                        json.dumps({"skip_reason": acquired.skip_reason})
                        if acquired.skip_reason
                        else "{}",
                        _now(),
                    ),
                )
            db.execute(
                "UPDATE imports SET workflow_state = 'ready_to_resolve', updated_at = ? WHERE id = ?",
                (_now(), import_id),
            )

    @staticmethod
    def _match_update(old_entries: list[StoredEntry], new_entries: list[AcquiredTrack]):
        """Match duplicate playlist occurrences without collapsing them."""
        unmatched = {entry.id: entry for entry in old_entries}
        matches: dict[int, StoredEntry] = {}
        for key in ("source_track_id", "isrc"):
            buckets: dict[str, list[StoredEntry]] = {}
            for old in old_entries:
                if old.id not in unmatched:
                    continue
                value = getattr(old.track, key)
                if value:
                    buckets.setdefault(value, []).append(old)
            for index, acquired in enumerate(new_entries):
                if index in matches:
                    continue
                value = getattr(acquired.track, key)
                candidates = buckets.get(value or "", [])
                if candidates:
                    old = candidates.pop(0)
                    matches[index] = old
                    unmatched.pop(old.id, None)
        return matches, list(unmatched.values())

    def preview_playlist_update(
        self, import_id: str, entries: list[AcquiredTrack]
    ) -> PlaylistUpdate:
        old_entries = self.entries(import_id)
        matches, removed = self._match_update(old_entries, entries)
        moved = sum(old.position != entries[index].position for index, old in matches.items())
        return PlaylistUpdate(
            len(entries) - len(matches), len(removed), moved, len(matches) - moved
        )

    def apply_playlist_update(
        self, import_id: str, playlist: PlaylistInfo, entries: list[AcquiredTrack]
    ) -> PlaylistUpdate:
        old_entries = self.entries(import_id)
        matches, removed = self._match_update(old_entries, entries)
        summary = PlaylistUpdate(
            len(entries) - len(matches),
            len(removed),
            sum(old.position != entries[index].position for index, old in matches.items()),
            sum(old.position == entries[index].position for index, old in matches.items()),
        )
        timestamp = _now()

        def snapshot(items):
            return [
                {
                    "position": item.position,
                    "source_track_id": item.track.source_track_id,
                    "title": item.track.title,
                    "artists": list(item.track.artists),
                    "album": item.track.album,
                    "isrc": item.track.isrc,
                }
                for item in items
            ]

        with self.connect() as db:
            db.execute(
                "UPDATE playlist_entries SET position = -position - 1 WHERE import_id = ?",
                (import_id,),
            )
            for index, acquired in enumerate(entries):
                track = acquired.track
                old = matches.get(index)
                if old:
                    db.execute(
                        """UPDATE playlist_entries SET position = ?, source_track_id = ?,
                        title = ?, artists_json = ?, album = ?, isrc = ?, duration_ms = ?,
                        acquisition_status = ?, skip_reason = ? WHERE id = ?""",
                        (
                            acquired.position,
                            track.source_track_id,
                            track.title,
                            json.dumps(track.artists),
                            track.album,
                            track.isrc,
                            track.duration_ms,
                            "skipped" if acquired.skip_reason else "acquired",
                            acquired.skip_reason,
                            old.id,
                        ),
                    )
                    if acquired.skip_reason and old.resolution_method != "source_skip":
                        db.execute(
                            """UPDATE resolutions SET state = 'skipped',
                            method = 'source_skip', result_json = '{}', evidence_json = ?,
                            is_manual = 0, validation_status = NULL, confirmed_at = NULL,
                            updated_at = ? WHERE entry_id = ?""",
                            (json.dumps({"skip_reason": acquired.skip_reason}), timestamp, old.id),
                        )
                    elif not acquired.skip_reason and old.resolution_method == "source_skip":
                        db.execute(
                            """UPDATE resolutions SET state = 'pending', method = NULL,
                            result_json = '{}', evidence_json = '{}', updated_at = ?
                            WHERE entry_id = ?""",
                            (timestamp, old.id),
                        )
                else:
                    cursor = db.execute(
                        """INSERT INTO playlist_entries
                        (import_id, position, source_track_id, title, artists_json, album, isrc,
                         duration_ms, acquisition_status, skip_reason)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            import_id,
                            acquired.position,
                            track.source_track_id,
                            track.title,
                            json.dumps(track.artists),
                            track.album,
                            track.isrc,
                            track.duration_ms,
                            "skipped" if acquired.skip_reason else "acquired",
                            acquired.skip_reason,
                        ),
                    )
                    db.execute(
                        """INSERT INTO resolutions
                        (entry_id, state, method, result_json, evidence_json, updated_at)
                        VALUES (?, ?, ?, '{}', ?, ?)""",
                        (
                            cursor.lastrowid,
                            "skipped" if acquired.skip_reason else "pending",
                            "source_skip" if acquired.skip_reason else None,
                            json.dumps({"skip_reason": acquired.skip_reason})
                            if acquired.skip_reason
                            else "{}",
                            timestamp,
                        ),
                    )
            for old in removed:
                db.execute("DELETE FROM playlist_entries WHERE id = ?", (old.id,))
            db.execute(
                "UPDATE lidarr_plans SET status = 'superseded' "
                "WHERE import_id = ? AND status IN ('draft', 'approved')",
                (import_id,),
            )
            db.execute(
                "DELETE FROM library_status WHERE entry_id IN "
                "(SELECT id FROM playlist_entries WHERE import_id = ?)",
                (import_id,),
            )
            state = "ready_to_resolve" if summary.added else "ready_to_plan"
            db.execute(
                """UPDATE imports SET playlist_name = ?, playlist_path = ?,
                workflow_state = ?, updated_at = ? WHERE id = ?""",
                (playlist.name, playlist.path, state, timestamp, import_id),
            )
            db.execute(
                """INSERT INTO playlist_revisions
                (id, import_id, created_at, before_json, after_json,
                 added, removed, moved, unchanged) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(uuid.uuid4()),
                    import_id,
                    timestamp,
                    json.dumps(snapshot(old_entries)),
                    json.dumps(snapshot(entries)),
                    summary.added,
                    summary.removed,
                    summary.moved,
                    summary.unchanged,
                ),
            )
        return summary

    def playlist_revisions(self, import_id: str) -> list[PlaylistRevision]:
        with self.connect() as db:
            rows = db.execute(
                """SELECT id, created_at, added, removed, moved, unchanged
                FROM playlist_revisions WHERE import_id = ? ORDER BY created_at DESC""",
                (import_id,),
            ).fetchall()
        return [
            PlaylistRevision(
                row["id"],
                row["created_at"],
                row["added"],
                row["removed"],
                row["moved"],
                row["unchanged"],
            )
            for row in rows
        ]

    def playlist_revision(self, import_id: str, revision_id: str) -> dict:
        with self.connect() as db:
            row = db.execute(
                """SELECT * FROM playlist_revisions
                WHERE id = ? AND import_id = ?""",
                (revision_id, import_id),
            ).fetchone()
        if row is None:
            raise KeyError(f"unknown playlist revision: {revision_id}")
        return {
            "id": row["id"],
            "created_at": row["created_at"],
            "before": json.loads(row["before_json"]),
            "after": json.loads(row["after_json"]),
            "added": row["added"],
            "removed": row["removed"],
            "moved": row["moved"],
            "unchanged": row["unchanged"],
        }

    @staticmethod
    def _result_json(result: MusicBrainzResult) -> str:
        payload = asdict(result)
        for key, value in payload.items():
            if isinstance(value, tuple):
                payload[key] = list(value)
        return json.dumps(payload)

    def save_automatic_resolution(
        self, entry_id: int, result: MusicBrainzResult, *, evidence: dict | None = None
    ) -> bool:
        """Persist automation unless a human-confirmed mapping owns the entry."""
        state = "automatically_resolved" if result.resolved_via else "unresolved"
        with self.connect() as db:
            current = db.execute(
                "SELECT is_manual FROM resolutions WHERE entry_id = ?", (entry_id,)
            ).fetchone()
            if current is None:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            if current["is_manual"]:
                return False
            db.execute(
                """UPDATE resolutions SET state = ?, method = ?, result_json = ?,
                evidence_json = ?, validation_status = NULL, updated_at = ? WHERE entry_id = ?""",
                (
                    state,
                    result.resolved_via,
                    self._result_json(result),
                    json.dumps(evidence or {}),
                    _now(),
                    entry_id,
                ),
            )
        return True

    def mark_resolving(self, entry_id: int) -> bool:
        with self.connect() as db:
            current = db.execute(
                "SELECT is_manual FROM resolutions WHERE entry_id = ?", (entry_id,)
            ).fetchone()
            if current is None:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            if current["is_manual"]:
                return False
            db.execute(
                "UPDATE resolutions SET state = 'resolving', updated_at = ? WHERE entry_id = ?",
                (_now(), entry_id),
            )
        return True

    def save_manual_resolution(
        self,
        entry_id: int,
        result: MusicBrainzResult,
        *,
        method: str,
        validation_status: str,
        evidence: dict | None = None,
        selected_release_group_id: str | None = None,
    ) -> None:
        if validation_status not in {"valid", "warning"}:
            raise ValueError("only validated manual mappings can be confirmed")
        if method not in {"manual_search", "manual_mbid", "imported_from_csv", "reused_manual"}:
            raise ValueError(f"invalid manual resolution method: {method}")
        timestamp = _now()
        with self.connect() as db:
            owner = db.execute(
                "SELECT import_id FROM playlist_entries WHERE id = ?", (entry_id,)
            ).fetchone()
            if owner is None:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            cursor = db.execute(
                """UPDATE resolutions SET state = 'manually_resolved', method = ?,
                result_json = ?, evidence_json = ?, is_manual = 1, validation_status = ?,
                selected_release_group_id = ?, confirmed_at = ?, updated_at = ? WHERE entry_id = ?""",
                (
                    method,
                    self._result_json(result),
                    json.dumps(evidence or {}),
                    validation_status,
                    selected_release_group_id,
                    timestamp,
                    timestamp,
                    entry_id,
                ),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            db.execute(
                "UPDATE lidarr_plans SET status = 'superseded' "
                "WHERE import_id = ? AND status = 'draft'",
                (owner["import_id"],),
            )
            db.execute(
                "UPDATE imports SET workflow_state = 'ready_to_plan', updated_at = ? WHERE id = ?",
                (timestamp, owner["import_id"]),
            )

    def save_imported_resolution(self, entry_id: int, result: MusicBrainzResult) -> None:
        state = "automatically_resolved" if result.resolved_via else "unresolved"
        with self.connect() as db:
            cursor = db.execute(
                """UPDATE resolutions SET state = ?, method = 'imported_from_csv',
                result_json = ?, evidence_json = ?, is_manual = 0, validation_status = NULL,
                updated_at = ? WHERE entry_id = ?""",
                (
                    state,
                    self._result_json(result),
                    json.dumps({"source": "mapping_csv"}),
                    _now(),
                    entry_id,
                ),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"unknown playlist entry: {entry_id}")

    def mark_skipped(self, entry_id: int) -> None:
        with self.connect() as db:
            owner = db.execute(
                "SELECT import_id FROM playlist_entries WHERE id = ?", (entry_id,)
            ).fetchone()
            if owner is None:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            cursor = db.execute(
                """UPDATE resolutions SET state = 'skipped', method = 'manual_skip',
                result_json = '{}', evidence_json = ?, is_manual = 1,
                validation_status = NULL, confirmed_at = ?, updated_at = ? WHERE entry_id = ?""",
                (json.dumps({"manual_action": "skip"}), _now(), _now(), entry_id),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            db.execute(
                "UPDATE lidarr_plans SET status = 'superseded' "
                "WHERE import_id = ? AND status = 'draft'",
                (owner["import_id"],),
            )

    def mark_validation_failed(self, entry_id: int, errors: tuple[str, ...]) -> None:
        with self.connect() as db:
            current = db.execute(
                "SELECT is_manual FROM resolutions WHERE entry_id = ?", (entry_id,)
            ).fetchone()
            if current is None:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            if current["is_manual"]:
                return
            db.execute(
                """UPDATE resolutions SET state = 'validation_failed',
                validation_status = 'invalid', evidence_json = ?, updated_at = ?
                WHERE entry_id = ?""",
                (json.dumps({"errors": errors}), _now(), entry_id),
            )

    def clear_manual_resolution(self, entry_id: int) -> None:
        with self.connect() as db:
            cursor = db.execute(
                """UPDATE resolutions SET state = 'pending', method = NULL,
                result_json = '{}', evidence_json = '{}', is_manual = 0,
                validation_status = NULL, selected_release_group_id = NULL,
                confirmed_at = NULL, updated_at = ? WHERE entry_id = ?""",
                (_now(), entry_id),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"unknown playlist entry: {entry_id}")

    def set_various_artists_override(self, entry_id: int, allowed: bool) -> None:
        """Persist an explicit per-track exception to the VA safety policy."""
        timestamp = _now()
        with self.connect() as db:
            row = db.execute(
                """SELECT e.import_id, r.evidence_json
                FROM playlist_entries e JOIN resolutions r ON r.entry_id = e.id
                WHERE e.id = ?""",
                (entry_id,),
            ).fetchone()
            if row is None:
                raise KeyError(f"unknown playlist entry: {entry_id}")
            evidence = json.loads(row["evidence_json"] or "{}")
            if allowed:
                evidence["allow_various_artists_release"] = True
            else:
                evidence.pop("allow_various_artists_release", None)
            db.execute(
                "UPDATE resolutions SET evidence_json = ?, updated_at = ? WHERE entry_id = ?",
                (json.dumps(evidence), timestamp, entry_id),
            )
            db.execute(
                "UPDATE lidarr_plans SET status = 'superseded' "
                "WHERE import_id = ? AND status = 'draft'",
                (row["import_id"],),
            )
            db.execute(
                "UPDATE imports SET workflow_state = 'ready_to_plan', updated_at = ? WHERE id = ?",
                (timestamp, row["import_id"]),
            )

    def entries(self, import_id: str) -> list[StoredEntry]:
        with self.connect() as db:
            rows = db.execute(
                """SELECT e.*, r.state, r.method, r.result_json, r.evidence_json,
                r.is_manual, r.validation_status, r.selected_release_group_id
                FROM playlist_entries e JOIN resolutions r ON r.entry_id = e.id
                WHERE e.import_id = ? ORDER BY e.position""",
                (import_id,),
            ).fetchall()
        result = []
        for row in rows:
            raw = json.loads(row["result_json"] or "{}")
            for field in (
                "artist_names",
                "recording_ids",
                "release_ids",
                "release_group_ids",
                "artist_ids",
            ):
                raw[field] = tuple(raw.get(field) or ())
            mb_result = MusicBrainzResult(**raw) if raw else MusicBrainzResult()
            track = SourceTrack(
                row["source"] if "source" in row.keys() else self.get_import(import_id).source,
                row["source_track_id"],
                row["title"],
                tuple(json.loads(row["artists_json"])),
                row["album"],
                row["isrc"],
                row["duration_ms"],
            )
            result.append(
                StoredEntry(
                    row["id"],
                    import_id,
                    row["position"],
                    track,
                    row["state"],
                    mb_result,
                    row["method"],
                    json.loads(row["evidence_json"] or "{}"),
                    bool(row["is_manual"]),
                    row["validation_status"],
                    row["selected_release_group_id"],
                )
            )
        return result

    def entry(self, entry_id: int) -> StoredEntry:
        with self.connect() as db:
            row = db.execute(
                "SELECT import_id FROM playlist_entries WHERE id = ?", (entry_id,)
            ).fetchone()
        if row is None:
            raise KeyError(f"unknown playlist entry: {entry_id}")
        return next(entry for entry in self.entries(row["import_id"]) if entry.id == entry_id)

    def manual_match_suggestions(self, entry_id: int) -> list[ManualMatchSuggestion]:
        """Find human-approved mappings for the exact same source track or ISRC."""
        target = self.entry(entry_id)
        target_import = self.get_import(target.import_id)
        suggestions: list[ManualMatchSuggestion] = []
        with self.connect() as db:
            rows = db.execute(
                """SELECT e.id, i.playlist_name
                FROM playlist_entries e
                JOIN imports i ON i.id = e.import_id
                JOIN resolutions r ON r.entry_id = e.id
                WHERE e.id != ? AND r.state = 'manually_resolved' AND r.is_manual = 1
                  AND ((? != '' AND e.isrc = ?)
                    OR (i.source = ? AND e.source_track_id = ?))
                ORDER BY r.confirmed_at DESC""",
                (
                    entry_id,
                    target.track.isrc or "",
                    target.track.isrc or "",
                    target_import.source,
                    target.track.source_track_id,
                ),
            ).fetchall()
        seen_results: set[tuple] = set()
        for row in rows:
            candidate = self.entry(row["id"])
            identity = (candidate.result.recording_ids, candidate.result.release_group_ids)
            if identity in seen_results:
                continue
            seen_results.add(identity)
            suggestions.append(ManualMatchSuggestion(candidate, row["playlist_name"]))
        return suggestions

    def save_candidates(self, entry_id: int, candidates: list[MusicBrainzCandidate]) -> None:
        with self.connect() as db:
            db.execute("DELETE FROM resolution_candidates WHERE entry_id = ?", (entry_id,))
            for position, candidate in enumerate(candidates):
                payload = asdict(candidate)
                db.execute(
                    """INSERT INTO resolution_candidates
                    (entry_id, position, candidate_json, created_at) VALUES (?, ?, ?, ?)""",
                    (entry_id, position, json.dumps(payload), _now()),
                )

    def save_lidarr_plan(self, import_id: str, plan: LidarrPlan) -> str:
        plan_id = str(uuid.uuid4())
        with self.connect() as db:
            db.execute(
                "UPDATE lidarr_plans SET status = 'superseded' WHERE import_id = ? AND status = 'draft'",
                (import_id,),
            )
            db.execute(
                "INSERT INTO lidarr_plans(id, import_id, status, created_at) VALUES (?, ?, 'draft', ?)",
                (plan_id, import_id, _now()),
            )
            for position, action in enumerate(plan.actions):
                db.execute(
                    """INSERT INTO lidarr_plan_actions(plan_id, position, action_json)
                    VALUES (?, ?, ?)""",
                    (plan_id, position, json.dumps(asdict(action))),
                )
            db.execute(
                "UPDATE imports SET workflow_state = 'plan_ready', updated_at = ? WHERE id = ?",
                (_now(), import_id),
            )
        return plan_id

    def get_lidarr_plan(self, plan_id: str) -> tuple[str, str, LidarrPlan]:
        with self.connect() as db:
            header = db.execute(
                "SELECT import_id, status FROM lidarr_plans WHERE id = ?", (plan_id,)
            ).fetchone()
            rows = db.execute(
                "SELECT action_json FROM lidarr_plan_actions WHERE plan_id = ? ORDER BY position",
                (plan_id,),
            ).fetchall()
        if header is None:
            raise KeyError(f"unknown Lidarr plan: {plan_id}")
        actions = tuple(LidarrPlanAction(**json.loads(row[0])) for row in rows)
        return header["import_id"], header["status"], LidarrPlan(actions)

    def latest_lidarr_plan(self, import_id: str) -> tuple[str, str, str, LidarrPlan] | None:
        with self.connect() as db:
            row = db.execute(
                """SELECT id FROM lidarr_plans WHERE import_id = ?
                ORDER BY created_at DESC LIMIT 1""",
                (import_id,),
            ).fetchone()
        return (row[0], *self.get_lidarr_plan(row[0])) if row else None

    def approve_lidarr_plan(self, plan_id: str) -> None:
        with self.connect() as db:
            cursor = db.execute(
                """UPDATE lidarr_plans SET status = 'approved', approved_at = ?
                WHERE id = ? AND status = 'draft'""",
                (_now(), plan_id),
            )
            if cursor.rowcount != 1:
                raise ValueError("only a current draft plan can be approved")

    def record_lidarr_execution(self, plan_id: str, results) -> None:
        with self.connect() as db:
            for position, result in enumerate(results):
                db.execute(
                    """INSERT INTO lidarr_execution_results
                    (plan_id, action_position, attempted_at, outcome, details)
                    VALUES (?, ?, ?, ?, ?)""",
                    (plan_id, position, _now(), result.outcome, result.details),
                )
            status = (
                "failed" if any(result.outcome == "failed" for result in results) else "completed"
            )
            db.execute("UPDATE lidarr_plans SET status = ? WHERE id = ?", (status, plan_id))
            db.execute(
                """UPDATE imports SET workflow_state = ?, updated_at = ?
                WHERE id = (SELECT import_id FROM lidarr_plans WHERE id = ?)""",
                (
                    "execution_failed" if status == "failed" else "waiting_for_downloads",
                    _now(),
                    plan_id,
                ),
            )

    def lidarr_execution_results(self, plan_id: str) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                """SELECT action_position, attempted_at, outcome, details
                FROM lidarr_execution_results WHERE plan_id = ? ORDER BY id""",
                (plan_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def save_library_status(self, import_id: str, statuses) -> None:
        entries = self.entries(import_id)
        by_position = {entry.position: entry for entry in entries}
        with self.connect() as db:
            for status in statuses:
                entry = by_position[status.position]
                db.execute(
                    """INSERT INTO library_status
                    (entry_id, classification, file_path, refreshed_at) VALUES (?, ?, ?, ?)
                    ON CONFLICT(entry_id) DO UPDATE SET classification = excluded.classification,
                    file_path = excluded.file_path, refreshed_at = excluded.refreshed_at""",
                    (entry.id, status.classification, status.path, _now()),
                )
            # A read-only status refresh must not advance an import that has not
            # been resolved/planned yet (and therefore hide its next action).
            db.execute(
                """UPDATE imports SET
                workflow_state = CASE
                    WHEN workflow_state IN ('waiting_for_downloads', 'library_status',
                                            'playlist_generated') THEN 'library_status'
                    ELSE workflow_state
                END,
                updated_at = ? WHERE id = ?""",
                (_now(), import_id),
            )

    def library_status(self, import_id: str) -> dict[int, tuple[str, str | None]]:
        with self.connect() as db:
            rows = db.execute(
                """SELECT e.position, s.classification, s.file_path
                FROM playlist_entries e JOIN library_status s ON s.entry_id = e.id
                WHERE e.import_id = ? ORDER BY e.position""",
                (import_id,),
            ).fetchall()
        return {row["position"]: (row["classification"], row["file_path"]) for row in rows}

    def record_playlist_export(
        self, import_id: str, output_path: Path, written: int, missing: int
    ) -> str:
        identifier = str(uuid.uuid4())
        with self.connect() as db:
            db.execute(
                """INSERT INTO playlist_exports
                (id, import_id, output_path, written_tracks, missing_tracks,
                 created_at) VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    identifier,
                    import_id,
                    str(output_path),
                    written,
                    missing,
                    _now(),
                ),
            )
            db.execute(
                "UPDATE imports SET workflow_state = 'playlist_generated', updated_at = ? WHERE id = ?",
                (_now(), import_id),
            )
        return identifier

    def latest_playlist_export(self, import_id: str) -> dict | None:
        with self.connect() as db:
            row = db.execute(
                """SELECT * FROM playlist_exports WHERE import_id = ?
                ORDER BY created_at DESC LIMIT 1""",
                (import_id,),
            ).fetchone()
        return dict(row) if row else None

    def save_playlist_analysis(
        self, source: str, playlist_id: str, playlist_name: str, status: str, result: dict
    ) -> None:
        with self.connect() as db:
            db.execute(
                """INSERT INTO playlist_analyses
                (source, playlist_id, playlist_name, status, result_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(source, playlist_id) DO UPDATE SET playlist_name = excluded.playlist_name,
                status = excluded.status, result_json = excluded.result_json,
                updated_at = excluded.updated_at""",
                (source, playlist_id, playlist_name, status, json.dumps(result), _now()),
            )

    def playlist_analyses(self, source: str) -> dict[str, dict]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM playlist_analyses WHERE source = ?", (source,)
            ).fetchall()
        return {
            row["playlist_id"]: {
                "status": row["status"],
                "updated_at": row["updated_at"],
                **json.loads(row["result_json"]),
            }
            for row in rows
        }

    def set_setting(self, key: str, value: object) -> None:
        with self.connect() as db:
            db.execute(
                """INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                updated_at = excluded.updated_at""",
                (key, json.dumps(value), _now()),
            )

    def get_setting(self, key: str, default: object = None) -> object:
        with self.connect() as db:
            row = db.execute("SELECT value_json FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def create_job(self, kind: str, import_id: str | None = None, *, total: int = 0) -> StoredJob:
        identifier = str(uuid.uuid4())
        timestamp = _now()
        with self.connect() as db:
            db.execute(
                """INSERT INTO jobs
                (id, import_id, kind, status, total, created_at, updated_at)
                VALUES (?, ?, ?, 'queued', ?, ?, ?)""",
                (identifier, import_id, kind, total, timestamp, timestamp),
            )
        return self.get_job(identifier)

    def get_job(self, job_id: str) -> StoredJob:
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise KeyError(f"unknown job: {job_id}")
        return StoredJob(
            row["id"],
            row["import_id"],
            row["kind"],
            row["status"],
            row["current"],
            row["total"],
            row["current_item"],
            bool(row["cancel_requested"]),
            row["error"],
        )

    def list_jobs(self, *, limit: int = 50) -> list[StoredJob]:
        with self.connect() as db:
            rows = db.execute(
                """SELECT id FROM jobs
                ORDER BY CASE status
                    WHEN 'running' THEN 0
                    WHEN 'queued' THEN 1
                    ELSE 2
                END,
                CASE WHEN status = 'queued' THEN created_at END ASC,
                updated_at DESC LIMIT ?""",
                (limit,),
            ).fetchall()
        return [self.get_job(row["id"]) for row in rows]

    def update_job(
        self,
        job_id: str,
        *,
        status: str | None = None,
        current: int | None = None,
        total: int | None = None,
        current_item: str | None = None,
        error: str | None = None,
    ) -> None:
        fields: dict[str, object] = {"updated_at": _now()}
        if status is not None:
            fields["status"] = status
        if current is not None:
            fields["current"] = current
        if total is not None:
            fields["total"] = total
        if current_item is not None:
            fields["current_item"] = current_item
        if error is not None:
            fields["error"] = error
        assignments = ", ".join(f"{key} = ?" for key in fields)
        with self.connect() as db:
            db.execute(f"UPDATE jobs SET {assignments} WHERE id = ?", (*fields.values(), job_id))

    def request_job_cancel(self, job_id: str) -> None:
        with self.connect() as db:
            db.execute(
                """UPDATE jobs SET cancel_requested = 1,
                status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
                updated_at = ? WHERE id = ?""",
                (_now(), job_id),
            )
