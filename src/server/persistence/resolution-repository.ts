import type Database from "better-sqlite3";
import {
  normalizeMusicBrainzResult,
  type MusicBrainzResult,
} from "../domain/musicbrainz";
const now = () => new Date().toISOString();
const manualMethods = new Set([
  "manual_search",
  "manual_mbid",
  "imported_from_csv",
  "reused_manual",
]);
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
}
