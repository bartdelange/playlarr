import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const SCHEMA_VERSION = 8;

export function openDatabase(databasePath: string): Database.Database {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma("busy_timeout = 10000");
  database.pragma("foreign_keys = ON");
  migrate(database);
  database.pragma("foreign_keys = ON");
  database
    .prepare(
      "UPDATE jobs SET status = 'interrupted', updated_at = ? WHERE status = 'running'",
    )
    .run(new Date().toISOString());
  return database;
}

export function migrate(database: Database.Database): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    migrateLocked(database);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function migrateLocked(database: Database.Database): void {
  let version = database.pragma("user_version", { simple: true }) as number;
  if (version > SCHEMA_VERSION)
    throw new Error(
      `database schema ${version} is newer than supported ${SCHEMA_VERSION}`,
    );
  const migration = (target: number, sql: string) => {
    database.exec(sql);
    database.pragma(`user_version = ${target}`);
    version = target;
  };
  if (version < 1)
    migration(
      1,
      `
    CREATE TABLE imports (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_playlist_id TEXT NOT NULL, playlist_name TEXT NOT NULL, playlist_path TEXT, playlist_metadata_json TEXT NOT NULL DEFAULT '{}', workflow_state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_error TEXT);
    CREATE INDEX imports_updated ON imports(updated_at DESC);
    CREATE TABLE playlist_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE, position INTEGER NOT NULL, source_track_id TEXT NOT NULL, title TEXT NOT NULL, artists_json TEXT NOT NULL, album TEXT NOT NULL, duration_ms INTEGER, isrc TEXT, acquisition_status TEXT NOT NULL DEFAULT 'acquired', skip_reason TEXT, UNIQUE(import_id, position));
    CREATE TABLE resolutions (entry_id INTEGER PRIMARY KEY REFERENCES playlist_entries(id) ON DELETE CASCADE, state TEXT NOT NULL, method TEXT, result_json TEXT NOT NULL DEFAULT '{}', evidence_json TEXT NOT NULL DEFAULT '{}', is_manual INTEGER NOT NULL DEFAULT 0, validation_status TEXT, selected_release_group_id TEXT, confirmed_at TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE lidarr_plans (id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE, status TEXT NOT NULL, created_at TEXT NOT NULL, approved_at TEXT);
    CREATE TABLE lidarr_plan_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT NOT NULL REFERENCES lidarr_plans(id) ON DELETE CASCADE, position INTEGER NOT NULL, action_json TEXT NOT NULL, UNIQUE(plan_id, position));
    CREATE TABLE lidarr_execution_results (id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT NOT NULL REFERENCES lidarr_plans(id) ON DELETE CASCADE, action_position INTEGER NOT NULL, attempted_at TEXT NOT NULL, outcome TEXT NOT NULL, details TEXT NOT NULL DEFAULT '');
    CREATE TABLE jobs (id TEXT PRIMARY KEY, import_id TEXT REFERENCES imports(id) ON DELETE CASCADE, kind TEXT NOT NULL, status TEXT NOT NULL, current INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, current_item TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE playlist_exports (id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE, output_path TEXT NOT NULL, written_tracks INTEGER NOT NULL, missing_tracks INTEGER NOT NULL, navidrome_matches INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);`,
    );
  if (version < 2)
    migration(
      2,
      "CREATE TABLE resolution_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES playlist_entries(id) ON DELETE CASCADE, position INTEGER NOT NULL, candidate_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(entry_id, position));",
    );
  if (version < 3)
    migration(
      3,
      "CREATE TABLE library_status (entry_id INTEGER PRIMARY KEY REFERENCES playlist_entries(id) ON DELETE CASCADE, classification TEXT NOT NULL, file_path TEXT, refreshed_at TEXT NOT NULL);",
    );
  if (version < 4)
    migration(
      4,
      "CREATE TABLE playlist_analyses (source TEXT NOT NULL, playlist_id TEXT NOT NULL, playlist_name TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(source, playlist_id));",
    );
  if (version < 5)
    migration(
      5,
      "CREATE TABLE playlist_revisions (id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE, created_at TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, added INTEGER NOT NULL, removed INTEGER NOT NULL, moved INTEGER NOT NULL, unchanged INTEGER NOT NULL); CREATE INDEX playlist_revisions_import ON playlist_revisions(import_id, created_at DESC);",
    );
  if (version < 6)
    migration(6, "ALTER TABLE jobs ADD COLUMN result_json TEXT;");
  if (version < 7)
    migration(
      7,
      "ALTER TABLE playlist_revisions ADD COLUMN updated INTEGER NOT NULL DEFAULT 0;",
    );
  if (version < 8)
    migration(
      8,
      "CREATE TABLE local_playlist_additions (id INTEGER PRIMARY KEY AUTOINCREMENT, import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE, provider TEXT NOT NULL, provider_track_id TEXT NOT NULL, ordinal INTEGER NOT NULL, title TEXT NOT NULL, artists_json TEXT NOT NULL, album TEXT NOT NULL, path_snapshot TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE(import_id, ordinal)); CREATE INDEX local_playlist_additions_import ON local_playlist_additions(import_id, ordinal);",
    );
}
