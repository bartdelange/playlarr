"""SQLite connection lifecycle and forward-only schema migrations."""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .timestamps import now

SCHEMA_VERSION = 7


class DatabaseRepository:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate()
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

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
                version = 5
            if version < 6:
                db.executescript("""
                    ALTER TABLE jobs ADD COLUMN result_json TEXT;
                    PRAGMA user_version = 6;
                """)
                version = 6
            if version < 7:
                revisions = db.execute(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'playlist_revisions'"
                ).fetchone()
                if revisions is not None:
                    db.execute(
                        "ALTER TABLE playlist_revisions "
                        "ADD COLUMN updated INTEGER NOT NULL DEFAULT 0"
                    )
                db.execute("PRAGMA user_version = 7")
            db.execute(
                "UPDATE jobs SET status = 'interrupted', updated_at = ? WHERE status = 'running'",
                (now(),),
            )
