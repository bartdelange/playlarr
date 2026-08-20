import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
const now = () => new Date().toISOString();
export interface LibraryStatus {
  position: number;
  classification: string;
  path?: string;
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
}
