import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
const now = () => new Date().toISOString();
export interface LibraryStatus {
  position: number;
  classification: string;
  path?: string;
}
export interface PlaylistExport {
  id: string;
  importId: string;
  outputPath: string;
  writtenTracks: number;
  missingTracks: number;
  createdAt: string;
}
export interface PlaylistAnalysis extends Record<string, unknown> {
  status: string;
  updatedAt: string;
}
export class LibraryRepository {
  constructor(private readonly database: Database.Database) {}
  saveStatus(importId: string, statuses: LibraryStatus[]): void {
    const entries = new Map(
      (
        this.database
          .prepare(
            "SELECT id, position FROM playlist_entries WHERE import_id = ?",
          )
          .all(importId) as { id: number; position: number }[]
      ).map((entry) => [entry.position, entry]),
    );
    const persist = this.database.transaction(() => {
      for (const status of statuses) {
        const entry = entries.get(status.position);
        if (!entry)
          throw new Error(`unknown playlist position: ${status.position}`);
        this.database
          .prepare(
            "INSERT INTO library_status (entry_id, classification, file_path, refreshed_at) VALUES (?, ?, ?, ?) ON CONFLICT(entry_id) DO UPDATE SET classification = excluded.classification, file_path = excluded.file_path, refreshed_at = excluded.refreshed_at",
          )
          .run(entry.id, status.classification, status.path ?? null, now());
      }
      this.database
        .prepare(
          "UPDATE imports SET workflow_state = CASE WHEN workflow_state IN ('waiting_for_downloads', 'library_status', 'playlist_generated') THEN 'library_status' ELSE workflow_state END, updated_at = ? WHERE id = ?",
        )
        .run(now(), importId);
    });
    persist();
  }
  recordExport(
    importId: string,
    outputPath: string,
    written: number,
    missing: number,
  ): string {
    const id = randomUUID();
    this.database
      .prepare(
        "INSERT INTO playlist_exports (id, import_id, output_path, written_tracks, missing_tracks, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, importId, outputPath, written, missing, now());
    this.database
      .prepare(
        "UPDATE imports SET workflow_state = 'playlist_generated', updated_at = ? WHERE id = ?",
      )
      .run(now(), importId);
    return id;
  }
  latestExport(importId: string): PlaylistExport | undefined {
    const row = this.database
      .prepare(
        `SELECT id, import_id, output_path, written_tracks, missing_tracks, created_at
         FROM playlist_exports
         WHERE import_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(importId) as
      | {
          id: string;
          import_id: string;
          output_path: string;
          written_tracks: number;
          missing_tracks: number;
          created_at: string;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          importId: row.import_id,
          outputPath: row.output_path,
          writtenTracks: row.written_tracks,
          missingTracks: row.missing_tracks,
          createdAt: row.created_at,
        }
      : undefined;
  }
  savePlaylistAnalysis(
    source: string,
    playlistId: string,
    playlistName: string,
    status: string,
    result: Record<string, unknown>,
  ): void {
    this.database
      .prepare(
        `INSERT INTO playlist_analyses
         (source, playlist_id, playlist_name, status, result_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(source, playlist_id) DO UPDATE SET
           playlist_name = excluded.playlist_name,
           status = excluded.status,
           result_json = excluded.result_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        source,
        playlistId,
        playlistName,
        status,
        JSON.stringify(result),
        now(),
      );
  }
  playlistAnalyses(source: string): Record<string, PlaylistAnalysis> {
    const rows = this.database
      .prepare(
        "SELECT playlist_id, status, result_json, updated_at FROM playlist_analyses WHERE source = ?",
      )
      .all(source) as {
      playlist_id: string;
      status: string;
      result_json: string;
      updated_at: string;
    }[];
    return Object.fromEntries(
      rows.map((row) => [
        row.playlist_id,
        {
          status: row.status,
          updatedAt: row.updated_at,
          ...(JSON.parse(row.result_json) as Record<string, unknown>),
        },
      ]),
    );
  }
}
