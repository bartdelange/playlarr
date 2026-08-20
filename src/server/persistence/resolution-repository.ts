import type Database from "better-sqlite3";
import {
  normalizeMusicBrainzResult,
  type MusicBrainzResult,
} from "../domain/musicbrainz";
import type { SourceTrack } from "../domain/playlist";
const now = () => new Date().toISOString();
const manualMethods = new Set([
  "manual_search",
  "manual_mbid",
  "imported_from_csv",
  "reused_manual",
]);
export interface ManualMatchSuggestion {
  entryId: number;
  playlistName: string;
  result: MusicBrainzResult;
  evidence: Record<string, unknown>;
  validationStatus: "valid" | "warning";
  selectedReleaseGroupId?: string;
}

export interface ReviewEntry {
  id: number;
  importId: string;
  position: number;
  playlistName: string;
  track: SourceTrack;
  resolution: ReturnType<ResolutionRepository["get"]>;
}
export class ResolutionRepository {
  constructor(private readonly database: Database.Database) {}
  get(entryId: number): {
    state: string;
    method?: string;
    result: MusicBrainzResult;
    evidence: Record<string, unknown>;
    isManual: boolean;
    validationStatus?: string;
    selectedReleaseGroupId?: string;
  } {
    const row = this.database
      .prepare("SELECT * FROM resolutions WHERE entry_id = ?")
      .get(entryId) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`unknown playlist entry: ${entryId}`);
    return {
      state: String(row.state),
      method: row.method ? String(row.method) : undefined,
      result: normalizeMusicBrainzResult(JSON.parse(String(row.result_json))),
      evidence: JSON.parse(String(row.evidence_json)) as Record<
        string,
        unknown
      >,
      isManual: Boolean(row.is_manual),
      validationStatus: row.validation_status
        ? String(row.validation_status)
        : undefined,
      selectedReleaseGroupId: row.selected_release_group_id
        ? String(row.selected_release_group_id)
        : undefined,
    };
  }
  candidates(entryId: number): object[] {
    return (
      this.database
        .prepare(
          "SELECT candidate_json FROM resolution_candidates WHERE entry_id = ? ORDER BY position",
        )
        .all(entryId) as { candidate_json: string }[]
    ).map((row) => JSON.parse(row.candidate_json) as object);
  }
  reviewEntry(entryId: number): ReviewEntry {
    const row = this.database
      .prepare(
        `SELECT e.*, i.source, i.playlist_name
         FROM playlist_entries e
         JOIN imports i ON i.id = e.import_id
         WHERE e.id = ?`,
      )
      .get(entryId) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`unknown playlist entry: ${entryId}`);
    return {
      id: entryId,
      importId: String(row.import_id),
      position: Number(row.position),
      playlistName: String(row.playlist_name),
      track: {
        source: String(row.source),
        sourceTrackId: String(row.source_track_id),
        title: String(row.title),
        artists: JSON.parse(String(row.artists_json)) as string[],
        album: String(row.album),
        isrc: row.isrc ? String(row.isrc) : undefined,
        durationMs:
          row.duration_ms === null ? undefined : Number(row.duration_ms),
      },
      resolution: this.get(entryId),
    };
  }
  reviewQueue(importId: string): ReviewEntry[] {
    return (
      this.database
        .prepare(
          `SELECT e.id
           FROM playlist_entries e
           JOIN resolutions r ON r.entry_id = e.id
           WHERE e.import_id = ?
             AND r.state IN ('unresolved', 'ambiguous', 'validation_failed')
           ORDER BY e.position`,
        )
        .all(importId) as { id: number }[]
    ).map((row) => this.reviewEntry(row.id));
  }
  manualMatchSuggestions(entryId: number): ManualMatchSuggestion[] {
    const target = this.reviewEntry(entryId);
    const rows = this.database
      .prepare(
        `SELECT e.id, i.playlist_name
         FROM playlist_entries e
         JOIN imports i ON i.id = e.import_id
         JOIN resolutions r ON r.entry_id = e.id
         WHERE e.id != ? AND r.state = 'manually_resolved' AND r.is_manual = 1
           AND ((? != '' AND e.isrc = ?)
             OR (i.source = ? AND e.source_track_id = ?))
         ORDER BY r.confirmed_at DESC`,
      )
      .all(
        entryId,
        target.track.isrc ?? "",
        target.track.isrc ?? "",
        target.track.source,
        target.track.sourceTrackId,
      ) as { id: number; playlist_name: string }[];
    const identities = new Set<string>();
    return rows.flatMap((row) => {
      const resolution = this.get(row.id);
      const identity = JSON.stringify([
        resolution.result.recordingIds ?? [],
        resolution.result.releaseGroupIds ?? [],
      ]);
      if (identities.has(identity)) return [];
      identities.add(identity);
      return [
        {
          entryId: row.id,
          playlistName: row.playlist_name,
          result: resolution.result,
          evidence: resolution.evidence,
          validationStatus:
            resolution.validationStatus === "warning" ? "warning" : "valid",
          selectedReleaseGroupId: resolution.selectedReleaseGroupId,
        },
      ];
    });
  }
  saveAutomatic(
    entryId: number,
    result: MusicBrainzResult,
    evidence: object = {},
  ): boolean {
    const current = this.database
      .prepare("SELECT is_manual FROM resolutions WHERE entry_id = ?")
      .get(entryId) as { is_manual: number } | undefined;
    if (!current) throw new Error(`unknown playlist entry: ${entryId}`);
    if (current.is_manual) return false;
    this.database
      .prepare(
        "UPDATE resolutions SET state = ?, method = ?, result_json = ?, evidence_json = ?, validation_status = NULL, updated_at = ? WHERE entry_id = ?",
      )
      .run(
        result.resolvedVia ? "automatically_resolved" : "unresolved",
        result.resolvedVia ?? null,
        JSON.stringify(result),
        JSON.stringify(evidence),
        now(),
        entryId,
      );
    return true;
  }
  saveImported(entryId: number, result: MusicBrainzResult): void {
    const outcome = this.database
      .prepare(
        `UPDATE resolutions SET state = ?, method = 'imported_from_csv',
         result_json = ?, evidence_json = ?, is_manual = 0,
         validation_status = NULL, updated_at = ? WHERE entry_id = ?`,
      )
      .run(
        result.resolvedVia ? "automatically_resolved" : "unresolved",
        JSON.stringify(result),
        JSON.stringify({ source: "mapping_csv" }),
        now(),
        entryId,
      );
    if (outcome.changes !== 1)
      throw new Error(`unknown playlist entry: ${entryId}`);
  }
  markResolving(entryId: number): boolean {
    const current = this.database
      .prepare("SELECT is_manual FROM resolutions WHERE entry_id = ?")
      .get(entryId) as { is_manual: number } | undefined;
    if (!current) throw new Error(`unknown playlist entry: ${entryId}`);
    if (current.is_manual) return false;
    this.database
      .prepare(
        "UPDATE resolutions SET state = 'resolving', updated_at = ? WHERE entry_id = ?",
      )
      .run(now(), entryId);
    return true;
  }
  saveCandidates(entryId: number, candidates: object[]): void {
    const save = this.database.transaction(() => {
      this.database
        .prepare("DELETE FROM resolution_candidates WHERE entry_id = ?")
        .run(entryId);
      const insert = this.database.prepare(
        "INSERT INTO resolution_candidates (entry_id, position, candidate_json, created_at) VALUES (?, ?, ?, ?)",
      );
      candidates.forEach((candidate, position) =>
        insert.run(entryId, position, JSON.stringify(candidate), now()),
      );
    });
    save();
  }
  saveManual(
    entryId: number,
    result: MusicBrainzResult,
    method: string,
    validationStatus: "valid" | "warning",
    evidence: object = {},
    selectedReleaseGroupId?: string,
  ): void {
    if (!manualMethods.has(method))
      throw new Error(`invalid manual resolution method: ${method}`);
    const owner = this.database
      .prepare("SELECT import_id FROM playlist_entries WHERE id = ?")
      .get(entryId) as { import_id: string } | undefined;
    if (!owner) throw new Error(`unknown playlist entry: ${entryId}`);
    const at = now();
    const write = this.database.transaction(() => {
      this.database
        .prepare(
          "UPDATE resolutions SET state = 'manually_resolved', method = ?, result_json = ?, evidence_json = ?, is_manual = 1, validation_status = ?, selected_release_group_id = ?, confirmed_at = ?, updated_at = ? WHERE entry_id = ?",
        )
        .run(
          method,
          JSON.stringify(result),
          JSON.stringify(evidence),
          validationStatus,
          selectedReleaseGroupId ?? null,
          at,
          at,
          entryId,
        );
      this.invalidateDraftPlans(owner.import_id);
      this.database
        .prepare(
          "UPDATE imports SET workflow_state = 'ready_to_plan', updated_at = ? WHERE id = ?",
        )
        .run(at, owner.import_id);
    });
    write();
  }
  clearManual(entryId: number): void {
    const result = this.database
      .prepare(
        "UPDATE resolutions SET state = 'pending', method = NULL, result_json = '{}', evidence_json = '{}', is_manual = 0, validation_status = NULL, selected_release_group_id = NULL, confirmed_at = NULL, updated_at = ? WHERE entry_id = ?",
      )
      .run(now(), entryId);
    if (result.changes !== 1)
      throw new Error(`unknown playlist entry: ${entryId}`);
  }
  markSkipped(entryId: number): void {
    const owner = this.owner(entryId);
    const at = now();
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE resolutions
           SET state = 'skipped', method = 'manual_skip', result_json = '{}',
             evidence_json = ?, is_manual = 1, validation_status = NULL,
             confirmed_at = ?, updated_at = ?
           WHERE entry_id = ?`,
        )
        .run(JSON.stringify({ manual_action: "skip" }), at, at, entryId);
      this.invalidateDraftPlans(owner);
    })();
  }
  markValidationFailed(entryId: number, errors: string[]): void {
    const current = this.database
      .prepare("SELECT is_manual FROM resolutions WHERE entry_id = ?")
      .get(entryId) as { is_manual: number } | undefined;
    if (!current) throw new Error(`unknown playlist entry: ${entryId}`);
    if (current.is_manual) return;
    this.database
      .prepare(
        `UPDATE resolutions
         SET state = 'validation_failed', validation_status = 'invalid',
           evidence_json = ?, updated_at = ?
         WHERE entry_id = ?`,
      )
      .run(JSON.stringify({ errors }), now(), entryId);
  }
  updateReviewWorkflow(importId: string): void {
    if (this.reviewQueue(importId).length) return;
    this.database
      .prepare(
        "UPDATE imports SET workflow_state = 'ready_to_plan', updated_at = ? WHERE id = ?",
      )
      .run(now(), importId);
  }
  requireReview(importId: string): void {
    this.database
      .prepare(
        "UPDATE imports SET workflow_state = 'review_required', updated_at = ? WHERE id = ?",
      )
      .run(now(), importId);
  }
  planBelongsToImport(planId: string, importId: string): boolean {
    return Boolean(
      this.database
        .prepare("SELECT 1 FROM lidarr_plans WHERE id = ? AND import_id = ?")
        .get(planId, importId),
    );
  }
  setVariousArtistsOverride(entryId: number, allowed: boolean): void {
    const row = this.database
      .prepare(
        "SELECT e.import_id, r.evidence_json FROM playlist_entries e JOIN resolutions r ON r.entry_id = e.id WHERE e.id = ?",
      )
      .get(entryId) as { import_id: string; evidence_json: string } | undefined;
    if (!row) throw new Error(`unknown playlist entry: ${entryId}`);
    const evidence = JSON.parse(row.evidence_json || "{}") as Record<
      string,
      unknown
    >;
    if (allowed) evidence.allow_various_artists_release = true;
    else delete evidence.allow_various_artists_release;
    const at = now();
    this.database.transaction(() => {
      this.database
        .prepare(
          "UPDATE resolutions SET evidence_json = ?, updated_at = ? WHERE entry_id = ?",
        )
        .run(JSON.stringify(evidence), at, entryId);
      this.invalidateDraftPlans(row.import_id);
      this.database
        .prepare(
          "UPDATE imports SET workflow_state = 'ready_to_plan', updated_at = ? WHERE id = ?",
        )
        .run(at, row.import_id);
    })();
  }
  private invalidateDraftPlans(importId: string): void {
    this.database
      .prepare(
        "UPDATE lidarr_plans SET status = 'superseded' WHERE import_id = ? AND status = 'draft'",
      )
      .run(importId);
  }
  private owner(entryId: number): string {
    const row = this.database
      .prepare("SELECT import_id FROM playlist_entries WHERE id = ?")
      .get(entryId) as { import_id: string } | undefined;
    if (!row) throw new Error(`unknown playlist entry: ${entryId}`);
    return row.import_id;
  }
}
