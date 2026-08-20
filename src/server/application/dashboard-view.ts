import type Database from "better-sqlite3";
import { normalizeMusicBrainzResult } from "../domain/musicbrainz";
import type { StoredImport } from "../domain/playlist";
import type { StoredJob } from "../persistence/job-repository";

export interface DashboardImportRow {
  imported: StoredImport;
  tracks: number;
  resolved: number;
  review: number;
  nextAction: string;
  job?: StoredJob;
}

export function dashboardImportRows(
  database: Database.Database,
  imports: StoredImport[],
  jobs: StoredJob[],
): DashboardImportRow[] {
  const activeJobs = new Map(
    jobs
      .filter(
        (job) => job.importId && ["queued", "running"].includes(job.status),
      )
      .map((job) => [job.importId!, job]),
  );

  return imports.map((imported) => {
    const resolutions = database
      .prepare(
        `SELECT r.state, r.result_json
         FROM playlist_entries e
         JOIN resolutions r ON r.entry_id = e.id
         WHERE e.import_id = ?`,
      )
      .all(imported.id) as { state: string; result_json: string }[];
    const review = resolutions.filter((row) =>
      ["unresolved", "ambiguous", "validation_failed"].includes(row.state),
    ).length;
    const resolved = resolutions.filter((row) =>
      Boolean(
        normalizeMusicBrainzResult(JSON.parse(row.result_json || "{}"))
          .resolvedVia,
      ),
    ).length;

    return {
      imported,
      tracks: resolutions.length,
      resolved,
      review,
      nextAction: dashboardNextAction(imported.workflowState, review),
      job: activeJobs.get(imported.id),
    };
  });
}

export function dashboardNextAction(state: string, review: number): string {
  if (["acquiring", "ready_to_resolve", "resolving"].includes(state))
    return "Resolve tracks";
  if (state === "review_required") return `Review ${review} tracks`;
  if (["ready_to_plan", "plan_ready"].includes(state))
    return "Review Lidarr mapping";
  if (state === "waiting_for_downloads") return "Check downloads";
  if (state === "library_status") return "Generate playlist";
  if (state === "playlist_generated") return "Playlist ready";
  return "Continue workflow";
}
