import type Database from "better-sqlite3";
import { LidarrPlanRepository } from "../persistence/lidarr-plan-repository";
import { ResolutionRepository } from "../persistence/resolution-repository";

export function changePlannedRelease(
  database: Database.Database,
  planId: string,
  entryId: number,
  releaseGroupId: string,
): string {
  const owner = validatePlanEntry(database, planId, entryId, true);
  const resolutions = new ResolutionRepository(database);
  const current = resolutions.get(entryId);

  if (!(current.result.releaseGroupIds ?? []).includes(releaseGroupId))
    throw new Error("the selected release does not belong to this track");

  resolutions.saveManual(
    entryId,
    { ...current.result, releaseGroupIds: [releaseGroupId] },
    current.method === "reused_manual" ? "reused_manual" : "manual_mbid",
    current.validationStatus === "warning" ? "warning" : "valid",
    current.evidence,
    releaseGroupId,
  );
  return owner;
}

export function allowVariousArtistsRelease(
  database: Database.Database,
  planId: string,
  entryId: number,
): string {
  const owner = validatePlanEntry(database, planId, entryId, false);
  new ResolutionRepository(database).setVariousArtistsOverride(entryId, true);
  return owner;
}

export function preparePlanEntryRetry(
  database: Database.Database,
  planId: string,
  entryId: number,
): string {
  const owner = validatePlanEntry(database, planId, entryId, true);
  const resolutions = new ResolutionRepository(database);
  if (resolutions.get(entryId).isManual) resolutions.clearManual(entryId);
  return owner;
}

function validatePlanEntry(
  database: Database.Database,
  planId: string,
  entryId: number,
  requireEditable: boolean,
): string {
  const plan = new LidarrPlanRepository(database).get(planId);
  if (requireEditable && !["draft", "superseded"].includes(plan.status))
    throw new Error("only a draft or superseded plan can be edited");

  const entry = database
    .prepare("SELECT import_id FROM playlist_entries WHERE id = ?")
    .get(entryId) as { import_id: string } | undefined;
  if (!entry || entry.import_id !== plan.importId)
    throw new Error("playlist entry does not belong to this Lidarr plan");
  return plan.importId;
}
