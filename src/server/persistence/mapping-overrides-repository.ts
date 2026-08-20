import type Database from "better-sqlite3";
import type { StoredEntry } from "../domain/playlist";

interface ResolutionRow {
  result_json: string;
  evidence_json: string;
  validation_status: string | null;
  selected_release_group_id: string | null;
}
export interface MappingOverrideCandidate {
  target: StoredEntry;
  source: StoredEntry;
  status: "conflict" | "already_same" | "will_override" | "will_map";
  sourceResult: Record<string, unknown>;
}
const now = () => new Date().toISOString();
const identity = (result: Record<string, unknown>) =>
  JSON.stringify([
    result.recordingIds ?? [],
    result.releaseGroupIds ?? [],
    result.primaryArtistId ?? null,
  ]);

export class MappingOverridesRepository {
  constructor(private readonly database: Database.Database) {}
  candidates(
    targetImportId: string,
    sourceImportId: string,
  ): MappingOverrideCandidate[] {
    if (targetImportId === sourceImportId)
      throw new Error("source and target imports must be different");
    const rows = (importId: string) =>
      this.database
        .prepare(
          `SELECT e.*, i.source AS import_source, r.state, r.is_manual, r.result_json FROM playlist_entries e JOIN imports i ON i.id = e.import_id JOIN resolutions r ON r.entry_id = e.id WHERE e.import_id = ? ORDER BY e.position`,
        )
        .all(importId) as Record<string, unknown>[];
    const stored = (row: Record<string, unknown>): StoredEntry => ({
      id: Number(row.id),
      importId: String(row.import_id),
      position: Number(row.position),
      track: {
        source: String(row.import_source),
        sourceTrackId: String(row.source_track_id),
        title: String(row.title),
        artists: JSON.parse(String(row.artists_json)) as string[],
        album: String(row.album),
        isrc: row.isrc ? String(row.isrc) : undefined,
        durationMs:
          row.duration_ms === null ? undefined : Number(row.duration_ms),
      },
      resolutionState: String(row.state),
      isManual: Boolean(row.is_manual),
    });
    const sources = new Map<string, Record<string, unknown>[]>();
    for (const row of rows(sourceImportId)) {
      const result = JSON.parse(String(row.result_json)) as Record<
        string,
        unknown
      >;
      if (row.isrc && result.resolvedVia)
        sources.set(String(row.isrc), [
          ...(sources.get(String(row.isrc)) ?? []),
          row,
        ]);
    }
    return rows(targetImportId).flatMap((targetRow) => {
      const matches = targetRow.isrc
        ? (sources.get(String(targetRow.isrc)) ?? [])
        : [];
      if (!matches.length) return [];
      const identities = new Set(
        matches.map((row) =>
          identity(
            JSON.parse(String(row.result_json)) as Record<string, unknown>,
          ),
        ),
      );
      const sourceRow = matches[0];
      const sourceResult = JSON.parse(String(sourceRow.result_json)) as Record<
        string,
        unknown
      >;
      const targetResult = JSON.parse(String(targetRow.result_json)) as Record<
        string,
        unknown
      >;
      const status =
        identities.size > 1
          ? "conflict"
          : identity(targetResult) === identity(sourceResult)
            ? "already_same"
            : targetResult.resolvedVia
              ? "will_override"
              : "will_map";
      return [
        {
          target: stored(targetRow),
          source: stored(sourceRow),
          status,
          sourceResult,
        },
      ];
    });
  }
  apply(
    targetImportId: string,
    sourceImportId: string,
    targetEntryIds: Set<number>,
  ): number {
    const selected = this.candidates(targetImportId, sourceImportId).filter(
      (item) =>
        targetEntryIds.has(item.target.id) &&
        ["will_override", "will_map"].includes(item.status),
    );
    const at = now();
    this.database.transaction(() => {
      for (const item of selected) {
        const source = this.database
          .prepare(
            "SELECT result_json, evidence_json, validation_status, selected_release_group_id FROM resolutions WHERE entry_id = ?",
          )
          .get(item.source.id) as ResolutionRow;
        const evidence = {
          ...(JSON.parse(source.evidence_json) as object),
          reused_from_entry_id: item.source.id,
          reused_from_import_id: sourceImportId,
          matched_by: "isrc",
        };
        this.database
          .prepare(
            "UPDATE resolutions SET state = 'manually_resolved', method = 'reused_manual', result_json = ?, evidence_json = ?, is_manual = 1, validation_status = ?, selected_release_group_id = ?, confirmed_at = ?, updated_at = ? WHERE entry_id = ?",
          )
          .run(
            source.result_json,
            JSON.stringify(evidence),
            source.validation_status ?? "valid",
            source.selected_release_group_id,
            at,
            at,
            item.target.id,
          );
        this.database
          .prepare("DELETE FROM library_status WHERE entry_id = ?")
          .run(item.target.id);
      }
      if (selected.length) {
        this.database
          .prepare(
            "UPDATE lidarr_plans SET status = 'superseded' WHERE import_id = ? AND status IN ('draft', 'approved')",
          )
          .run(targetImportId);
        const unresolved = this.database
          .prepare(
            "SELECT COUNT(*) FROM playlist_entries e JOIN resolutions r ON r.entry_id = e.id WHERE e.import_id = ? AND r.state IN ('pending', 'resolving', 'unresolved', 'ambiguous', 'validation_failed')",
          )
          .pluck()
          .get(targetImportId) as number;
        this.database
          .prepare(
            "UPDATE imports SET workflow_state = ?, updated_at = ? WHERE id = ?",
          )
          .run(
            unresolved ? "review_required" : "ready_to_plan",
            at,
            targetImportId,
          );
      }
    })();
    return selected.length;
  }
}
