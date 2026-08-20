import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AcquiredTrack, StoredEntry } from "../domain/playlist";
import {
  previewPlaylistUpdate,
  type PlaylistUpdate,
} from "../domain/playlist-updates";
const now = () => new Date().toISOString();
const snapshot = (entries: (StoredEntry | AcquiredTrack)[]) =>
  entries.map((entry) => ({
    position: entry.position,
    sourceTrackId: entry.track.sourceTrackId,
    title: entry.track.title,
    artists: entry.track.artists,
    album: entry.track.album,
    isrc: entry.track.isrc,
    durationMs: entry.track.durationMs,
    skipReason: "skipReason" in entry ? entry.skipReason : undefined,
  }));
export class PlaylistRevisionRepository {
  constructor(private readonly database: Database.Database) {}
  record(
    importId: string,
    before: StoredEntry[],
    after: AcquiredTrack[],
    update = previewPlaylistUpdate(before, after),
  ): { id: string; update: PlaylistUpdate } {
    const id = randomUUID();
    this.database
      .prepare(
        "INSERT INTO playlist_revisions (id, import_id, created_at, before_json, after_json, added, removed, updated, moved, unchanged) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        importId,
        now(),
        JSON.stringify(snapshot(before)),
        JSON.stringify(snapshot(after)),
        update.added,
        update.removed,
        update.updated,
        update.moved,
        update.unchanged,
      );
    return { id, update };
  }
  list(importId: string): {
    id: string;
    added: number;
    removed: number;
    updated: number;
    moved: number;
    unchanged: number;
  }[] {
    return this.database
      .prepare(
        "SELECT id, added, removed, updated, moved, unchanged FROM playlist_revisions WHERE import_id = ? ORDER BY created_at DESC",
      )
      .all(importId) as {
      id: string;
      added: number;
      removed: number;
      updated: number;
      moved: number;
      unchanged: number;
    }[];
  }
  get(importId: string, id: string): { before: unknown[]; after: unknown[] } {
    const row = this.database
      .prepare(
        "SELECT before_json, after_json FROM playlist_revisions WHERE id = ? AND import_id = ?",
      )
      .get(id, importId) as
      { before_json: string; after_json: string } | undefined;
    if (!row) throw new Error(`unknown playlist revision: ${id}`);
    return {
      before: JSON.parse(row.before_json),
      after: JSON.parse(row.after_json),
    };
  }
}
