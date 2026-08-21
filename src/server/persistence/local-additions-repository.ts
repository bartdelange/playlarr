import type Database from "better-sqlite3";
import type { LocalAddition } from "../application/playlist-export";

export interface StoredLocalAddition extends LocalAddition {
  id: number;
  importId: string;
  ordinal: number;
  pathSnapshot: string;
}
export class LocalAdditionsRepository {
  constructor(private readonly database: Database.Database) {}
  list(importId: string): StoredLocalAddition[] {
    return (
      this.database
        .prepare("SELECT * FROM local_playlist_additions WHERE import_id = ? ORDER BY ordinal, id")
        .all(importId) as Record<string, unknown>[]
    ).map((row) => ({
      id: Number(row.id),
      importId: String(row.import_id),
      provider: String(row.provider),
      providerTrackId: String(row.provider_track_id),
      ordinal: Number(row.ordinal),
      title: String(row.title),
      artists: JSON.parse(String(row.artists_json)) as string[],
      album: String(row.album),
      pathSnapshot: String(row.path_snapshot),
    }));
  }
  add(importId: string, addition: LocalAddition, pathSnapshot = ""): number {
    if (!this.database.prepare("SELECT 1 FROM imports WHERE id = ?").get(importId))
      throw new Error(`unknown import: ${importId}`);
    const ordinal = Number(
      (
        this.database
          .prepare("SELECT COALESCE(MAX(ordinal), -1) + 1 value FROM local_playlist_additions WHERE import_id = ?")
          .get(importId) as { value: number }
      ).value,
    );
    return Number(
      this.database
        .prepare(
          "INSERT INTO local_playlist_additions(import_id, provider, provider_track_id, ordinal, title, artists_json, album, path_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          importId,
          addition.provider,
          addition.providerTrackId,
          ordinal,
          addition.title,
          JSON.stringify(addition.artists),
          addition.album,
          pathSnapshot,
          new Date().toISOString(),
        ).lastInsertRowid,
    );
  }
  remove(importId: string, id: number): void {
    const result = this.database
      .prepare("DELETE FROM local_playlist_additions WHERE id = ? AND import_id = ?")
      .run(id, importId);
    if (result.changes !== 1) throw new Error(`local playlist addition ${id} does not exist`);
  }
}
