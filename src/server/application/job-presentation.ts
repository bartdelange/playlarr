import type { StoredJob } from "../persistence/job-repository";

export function jobCompletionUrl(job: StoredJob): string | undefined {
  if (job.importId && job.kind === "lidarr_planning")
    return `/imports/${job.importId}?stage=lidarr`;
  if (job.importId && job.kind === "playlist_update_preview")
    return `/imports/${job.importId}/update?preview_job=${job.id}`;
  if (job.kind === "playlist_catalogue" && job.payload?.source)
    return `/imports/new?${new URLSearchParams({
      source: String(job.payload.source),
      catalog_job: job.id,
    })}`;
  return job.importId ? `/imports/${job.importId}` : undefined;
}

export function queuePositions(jobs: StoredJob[]): Map<string, number> {
  let position = 0;
  return new Map(
    jobs
      .filter((job) => job.status === "queued")
      .map((job) => [job.id, ++position]),
  );
}
