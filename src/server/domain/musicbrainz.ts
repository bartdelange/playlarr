export interface MusicBrainzResult {
  resolvedVia?: string;
  recordingTitle?: string;
  artistNames?: string[];
  recordingIds?: string[];
  releaseIds?: string[];
  releaseGroupIds?: string[];
  artistIds?: string[];
  primaryArtistId?: string;
  failureReason?: string;
}

export function normalizeMusicBrainzResult(value: unknown): MusicBrainzResult {
  const result = record(value);

  return {
    resolvedVia: stringValue(result.resolvedVia, result.resolved_via),
    recordingTitle: stringValue(result.recordingTitle, result.recording_title),
    artistNames: stringValues(result.artistNames, result.artist_names),
    recordingIds: stringValues(result.recordingIds, result.recording_ids),
    releaseIds: stringValues(result.releaseIds, result.release_ids),
    releaseGroupIds: stringValues(result.releaseGroupIds, result.release_group_ids),
    artistIds: stringValues(result.artistIds, result.artist_ids),
    primaryArtistId: stringValue(result.primaryArtistId, result.primary_artist_id),
    failureReason: stringValue(result.failureReason, result.failure_reason),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function stringValues(...values: unknown[]): string[] {
  const value = values.find(Array.isArray);
  return value?.filter((item): item is string => typeof item === "string") ?? [];
}
