import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AcquiredTrack, PlaylistInfo, SourceTrack, StoredEntry, StoredImport } from "../domain/playlist";
import { previewPlaylistUpdate, type PlaylistUpdate } from "../domain/playlist-updates";

const timestamp = () => new Date().toISOString();
const optional = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

export class ImportRepository {
  constructor(private readonly database: Database.Database) {}

  createImport(playlist: PlaylistInfo, metadata: object = {}, importId = randomUUID()): StoredImport {
    const now = timestamp();
    this.database.prepare(`INSERT INTO imports (id, source, source_playlist_id, playlist_name, playlist_path, playlist_metadata_json, workflow_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'acquiring', ?, ?)`)
      .run(importId, playlist.source, playlist.id, playlist.name, playlist.path ?? null, JSON.stringify(metadata), now, now);
    return this.getImport(importId);
  }

  getImport(importId: string): StoredImport {
    const row = this.database.prepare("SELECT * FROM imports WHERE id = ?").get(importId) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`unknown import: ${importId}`);
    return { id: row.id as string, source: row.source as string, sourcePlaylistId: row.source_playlist_id as string, playlistName: row.playlist_name as string, playlistPath: optional(row.playlist_path), workflowState: row.workflow_state as string, createdAt: row.created_at as string, updatedAt: row.updated_at as string, lastError: optional(row.last_error) };
  }

  listImports(limit = 100): StoredImport[] { return (this.database.prepare("SELECT id FROM imports ORDER BY updated_at DESC LIMIT ?").all(limit) as { id: string }[]).map((row) => this.getImport(row.id)); }

  entries(importId: string): StoredEntry[] {
    return (this.database.prepare(`SELECT entries.*, imports.source AS import_source, resolutions.state, resolutions.is_manual FROM playlist_entries entries JOIN imports ON imports.id = entries.import_id JOIN resolutions ON resolutions.entry_id = entries.id WHERE entries.import_id = ? ORDER BY entries.position`).all(importId) as Record<string, unknown>[])
      .map((row) => ({ id: row.id as number, importId: row.import_id as string, position: row.position as number, track: { source: row.import_source as string, sourceTrackId: row.source_track_id as string, title: row.title as string, artists: JSON.parse(row.artists_json as string) as string[], album: row.album as string, isrc: optional(row.isrc), durationMs: row.duration_ms as number | undefined }, resolutionState: row.state as string, isManual: Boolean(row.is_manual) }));
  }

  replaceTracks(importId: string, tracks: SourceTrack[]): void { this.replaceAcquiredTracks(importId, tracks.map((track, position) => ({ position, track }))); }

  replaceAcquiredTracks(importId: string, entries: AcquiredTrack[]): void {
    const replace = this.database.transaction(() => {
      this.database.prepare("DELETE FROM playlist_entries WHERE import_id = ?").run(importId);
      const add = this.database.prepare(`INSERT INTO playlist_entries (import_id, position, source_track_id, title, artists_json, album, isrc, duration_ms, acquisition_status, skip_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const resolve = this.database.prepare("INSERT INTO resolutions (entry_id, state, method, result_json, evidence_json, updated_at) VALUES (?, ?, ?, '{}', ?, ?)");
      for (const entry of entries) {
        const result = add.run(importId, entry.position, entry.track.sourceTrackId, entry.track.title, JSON.stringify(entry.track.artists), entry.track.album, entry.track.isrc ?? null, entry.track.durationMs ?? null, entry.skipReason ? "skipped" : "acquired", entry.skipReason ?? null);
        resolve.run(result.lastInsertRowid, entry.skipReason ? "skipped" : "pending", entry.skipReason ? "source_skip" : null, entry.skipReason ? JSON.stringify({ skip_reason: entry.skipReason }) : "{}", timestamp());
      }
      this.database.prepare("UPDATE imports SET workflow_state = 'ready_to_resolve', updated_at = ? WHERE id = ?").run(timestamp(), importId);
    });
    replace();
  }

  deleteImport(importId: string): void {
    if (!this.database.prepare("SELECT 1 FROM imports WHERE id = ?").get(importId)) throw new Error(`unknown import: ${importId}`);
    if (this.database.prepare("SELECT 1 FROM jobs WHERE import_id = ? AND status IN ('queued', 'running')").get(importId)) throw new Error("cancel or wait for the active job before deleting this import");
    this.database.prepare("DELETE FROM imports WHERE id = ?").run(importId);
  }

  setWorkflowState(importId: string, state: string, error?: string): void { this.database.prepare("UPDATE imports SET workflow_state = ?, last_error = ?, updated_at = ? WHERE id = ?").run(state, error ?? null, timestamp(), importId); }
  updatePlaylist(importId: string, playlist: PlaylistInfo, metadata: object = {}): void { this.database.prepare("UPDATE imports SET playlist_name = ?, playlist_path = ?, playlist_metadata_json = ?, updated_at = ? WHERE id = ?").run(playlist.name, playlist.path ?? null, JSON.stringify(metadata), timestamp(), importId); }
  applyPlaylistUpdate(importId: string, playlist: PlaylistInfo, current: AcquiredTrack[]): PlaylistUpdate { const before = this.entries(importId); const update = previewPlaylistUpdate(before, current); const unmatched = new Map(before.map((entry) => [entry.id, entry])); const matches = new Map<number, StoredEntry>(); for (const field of ["sourceTrackId", "isrc"] as const) { const buckets = new Map<string, StoredEntry[]>(); for (const entry of unmatched.values()) { const value = entry.track[field]; if (value) buckets.set(value, [...(buckets.get(value) ?? []), entry]); } current.forEach((entry, index) => { if (matches.has(index)) return; const value = entry.track[field]; const old = value ? buckets.get(value)?.shift() : undefined; if (old) { matches.set(index, old); unmatched.delete(old.id); } }); } const at = timestamp(); this.database.transaction(() => { this.database.prepare("UPDATE playlist_entries SET position = -position - 1 WHERE import_id = ?").run(importId); const add = this.database.prepare("INSERT INTO playlist_entries (import_id, position, source_track_id, title, artists_json, album, isrc, duration_ms, acquisition_status, skip_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"); const resolution = this.database.prepare("INSERT INTO resolutions (entry_id, state, method, result_json, evidence_json, updated_at) VALUES (?, ?, ?, '{}', ?, ?)"); const change = this.database.prepare("UPDATE playlist_entries SET position = ?, source_track_id = ?, title = ?, artists_json = ?, album = ?, isrc = ?, duration_ms = ?, acquisition_status = ?, skip_reason = ? WHERE id = ?"); current.forEach((entry, index) => { const old = matches.get(index); const values = [entry.position, entry.track.sourceTrackId, entry.track.title, JSON.stringify(entry.track.artists), entry.track.album, entry.track.isrc ?? null, entry.track.durationMs ?? null, entry.skipReason ? "skipped" : "acquired", entry.skipReason ?? null] as const; if (old) change.run(...values, old.id); else { const inserted = add.run(importId, ...values); resolution.run(inserted.lastInsertRowid, entry.skipReason ? "skipped" : "pending", entry.skipReason ? "source_skip" : null, entry.skipReason ? JSON.stringify({ skip_reason: entry.skipReason }) : "{}", at); } }); unmatched.forEach((entry) => this.database.prepare("DELETE FROM playlist_entries WHERE id = ?").run(entry.id)); this.database.prepare("UPDATE lidarr_plans SET status = 'superseded' WHERE import_id = ? AND status IN ('draft', 'approved')").run(importId); this.database.prepare("DELETE FROM library_status WHERE entry_id IN (SELECT id FROM playlist_entries WHERE import_id = ?)").run(importId); this.database.prepare("UPDATE imports SET playlist_name = ?, playlist_path = ?, workflow_state = ?, updated_at = ? WHERE id = ?").run(playlist.name, playlist.path ?? null, update.added ? "ready_to_resolve" : "ready_to_plan", at, importId); this.database.prepare("INSERT INTO playlist_revisions (id, import_id, created_at, before_json, after_json, added, removed, updated, moved, unchanged) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), importId, at, JSON.stringify(before), JSON.stringify(current), update.added, update.removed, update.updated, update.moved, update.unchanged); })(); return update; }
}
