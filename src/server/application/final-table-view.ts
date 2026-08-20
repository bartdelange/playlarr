import type { LidarrPlanAction } from "../domain/lidarr";
import type { MusicBrainzResult } from "../domain/musicbrainz";
import type { SourceTrack } from "../domain/playlist";

const downloadedClassifications = new Set([
  "represented_locally",
  "release_downloaded",
  "recording_match",
  "alternate_version_title_match",
]);
const downloadableClassifications = new Set([
  "artist_missing",
  "release_missing",
  "release_unmonitored_missing",
  "release_monitored_missing",
]);

export type LibraryAvailability =
  "downloaded" | "downloadable" | "not_downloadable" | "not_refreshed";

export interface FinalTableEntry {
  id: number;
  position: number;
  resolutionState: string;
  track: SourceTrack;
  result: MusicBrainzResult;
  libraryClassification?: string;
  libraryPath?: string;
}

export interface FinalExecutionResult {
  actionPosition: number;
  outcome: string;
  details?: string;
}

export interface FinalExecutionNote {
  action: string;
  reason?: string;
  outcome: string;
  details?: string;
}

export interface FinalLidarrMatch {
  title: string;
  trackNumber?: string | number;
  foreignRecordingId?: string;
  matchMethod?: string;
  hasFile: boolean;
  trackFileId?: string | number;
  albumTitle?: string;
  releaseGroupId?: string;
}

export interface FinalTableRow extends FinalTableEntry {
  availability: LibraryAvailability;
  lidarrMatch?: FinalLidarrMatch;
  executionNotes: FinalExecutionNote[];
}

export function finalAvailabilityCounts(rows: FinalTableRow[]) {
  return {
    downloaded: rows.filter((row) => row.availability === "downloaded").length,
    downloadable: rows.filter((row) => row.availability === "downloadable")
      .length,
    not_downloadable: rows.filter(
      (row) => row.availability === "not_downloadable",
    ).length,
  };
}

export function filterFinalRows(
  rows: FinalTableRow[],
  filter: "all" | LibraryAvailability,
) {
  return rows.filter((row) => filter === "all" || row.availability === filter);
}

export function finalTableRows(
  entries: FinalTableEntry[],
  actions: LidarrPlanAction[],
  execution: FinalExecutionResult[] = [],
): FinalTableRow[] {
  const executed = new Map(
    execution.map((result) => [result.actionPosition, result]),
  );

  return entries.map((entry) => {
    const relevantActions = actions
      .map((action, actionPosition) => ({ action, actionPosition }))
      .filter(({ action }) => actionMatchesEntry(action, entry.result));
    const executionNotes = relevantActions.flatMap(
      ({ action, actionPosition }): FinalExecutionNote[] => {
        const result = executed.get(actionPosition);
        return result
          ? [
              {
                action: action.action,
                reason: action.reason,
                outcome: result.outcome,
                details: result.details,
              },
            ]
          : [];
      },
    );
    const matchedAction = relevantActions.find(({ action }) =>
      record(action.payload?.matched_track),
    )?.action;
    const matchedTrack = record(matchedAction?.payload?.matched_track);
    let availability = libraryAvailability(
      entry.libraryClassification,
      entry.libraryPath,
    );
    if (
      executionNotes.some((note) =>
        ["various_artists_album", "various_artists_skipped"].includes(
          note.reason ?? "",
        ),
      )
    )
      availability = "not_downloadable";

    return {
      ...entry,
      availability,
      lidarrMatch: matchedTrack
        ? {
            title: text(matchedTrack.title) || entry.track.title,
            trackNumber: scalar(matchedTrack.track_number),
            foreignRecordingId: text(matchedTrack.foreign_recording_id),
            matchMethod: text(matchedTrack.match_method),
            hasFile: Boolean(matchedTrack.has_file),
            trackFileId: scalar(matchedTrack.track_file_id),
            albumTitle:
              matchedAction?.albumTitle ??
              entry.track.album ??
              "Lidarr release",
            releaseGroupId: matchedAction?.releaseGroupId,
          }
        : undefined,
      executionNotes,
    };
  });
}

export function libraryAvailability(
  classification?: string,
  path?: string,
): LibraryAvailability {
  if (!classification) return "not_refreshed";
  if (path || downloadedClassifications.has(classification))
    return "downloaded";
  if (downloadableClassifications.has(classification)) return "downloadable";
  return "not_downloadable";
}

function actionMatchesEntry(
  action: LidarrPlanAction,
  result: MusicBrainzResult,
): boolean {
  if (action.artistMbid !== result.primaryArtistId) return false;
  const requested = strings(action.payload, "requested_recording_ids");
  if (requested.length && !intersects(requested, result.recordingIds ?? []))
    return false;
  const sourceGroups = new Set(
    strings(action.payload, "mapped_release_group_ids"),
  );
  if (
    action.releaseGroupId &&
    result.releaseGroupIds?.includes(action.releaseGroupId)
  )
    sourceGroups.add(action.releaseGroupId);
  return intersects([...sourceGroups], result.releaseGroupIds ?? []);
}

function strings(payload: Record<string, unknown> | undefined, key: string) {
  const value = payload?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function intersects(left: string[], right: string[]) {
  const values = new Set(right);
  return left.some((value) => values.has(value));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function scalar(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number"
    ? value
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
