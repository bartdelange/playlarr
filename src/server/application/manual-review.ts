import type { ManualValidation } from "../integrations/musicbrainz/candidates";
import type { JobRepository, StoredJob } from "../persistence/job-repository";
import type { ResolutionRepository } from "../persistence/resolution-repository";

export type ManualResolutionMethod = "manual_search" | "manual_mbid";

export function confirmManualResolution(
  repository: ResolutionRepository,
  entryId: number,
  validation: ManualValidation,
  method: ManualResolutionMethod,
  allowWarning: boolean,
  selectedReleaseGroupId?: string,
): void {
  if (validation.status === "invalid" || !validation.candidate)
    throw new Error("invalid MusicBrainz recording mapping");
  if (validation.status === "warning" && !allowWarning)
    throw new Error("mapping has warnings and requires explicit confirmation");
  const groups = validation.candidate.result.releaseGroupIds ?? [];
  if (groups.length > 1 && !selectedReleaseGroupId)
    throw new Error("select a release group for this recording");
  if (selectedReleaseGroupId && !groups.includes(selectedReleaseGroupId))
    throw new Error("release group is not associated with this recording");
  repository.saveManual(
    entryId,
    selectedReleaseGroupId
      ? {
          ...validation.candidate.result,
          releaseGroupIds: [selectedReleaseGroupId],
        }
      : validation.candidate.result,
    method,
    validation.status,
    validation.candidate.evidence,
    selectedReleaseGroupId,
  );
  repository.updateReviewWorkflow(repository.reviewEntry(entryId).importId);
}

export function reviewDecisionDestination(
  repository: ResolutionRepository,
  entryId: number,
  session: boolean,
  planId?: string,
): string {
  const entry = repository.reviewEntry(entryId);
  if (planId) {
    if (!repository.planBelongsToImport(planId, entry.importId))
      throw new Error("Lidarr plan does not belong to this playlist");
    return `/imports/${entry.importId}?stage=lidarr`;
  }
  if (!session) return `/imports/${entry.importId}`;
  const queue = repository.reviewQueue(entry.importId);
  const target =
    queue.find((item) => item.position > entry.position) ?? queue[0];
  return target
    ? `/entries/${target.id}/review?session=true`
    : `/imports/${entry.importId}`;
}

export function reusePreviousResolution(
  repository: ResolutionRepository,
  entryId: number,
  sourceEntryId: number,
): void {
  const suggestion = repository
    .manualMatchSuggestions(entryId)
    .find((item) => item.entryId === sourceEntryId);
  if (!suggestion)
    throw new Error("that manual match is not available for this track");
  repository.saveManual(
    entryId,
    suggestion.result,
    "reused_manual",
    suggestion.validationStatus,
    {
      ...suggestion.evidence,
      reused_from_entry_id: suggestion.entryId,
      reused_from_playlist: suggestion.playlistName,
    },
    suggestion.selectedReleaseGroupId,
  );
  repository.updateReviewWorkflow(repository.reviewEntry(entryId).importId);
}

export function prepareAutomaticRetry(
  repository: ResolutionRepository,
  jobs: JobRepository,
  entryId: number,
  planId?: string,
): StoredJob {
  const entry = repository.reviewEntry(entryId);
  if (entry.resolution.isManual) {
    if (!planId)
      throw new Error("clear the manual override before retrying automation");
    if (!repository.planBelongsToImport(planId, entry.importId))
      throw new Error("Lidarr plan does not belong to this playlist");
    repository.clearManual(entryId);
  }
  return jobs.create("resolution_retry", entry.importId, 1, { entryId });
}
