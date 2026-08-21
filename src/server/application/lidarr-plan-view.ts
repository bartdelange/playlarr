import type { LidarrPlan, LidarrPlanAction } from "../domain/lidarr";
import type { MusicBrainzResult } from "../domain/musicbrainz";
import type { SourceTrack } from "../domain/playlist";

const mutatingActions = new Set([
  "create_artist",
  "create_release",
  "monitor_artist",
  "monitor_release",
  "queue_search",
]);

export interface LidarrPlanEntry {
  id: number;
  position: number;
  resolutionState: string;
  isManual: boolean;
  track: SourceTrack;
  result: MusicBrainzResult;
  evidence: Record<string, unknown>;
  selectedReleaseGroupId?: string;
}

export interface LidarrReleaseView {
  sourceGroup: string;
  lidarrGroup: string;
  title: string;
  artistName: string;
  actions: LidarrPlanAction[];
  matchedTrack?: Record<string, unknown>;
  lidarrAlbumId?: string | number;
}

export interface LidarrPlanRow {
  entry: LidarrPlanEntry;
  releases: LidarrReleaseView[];
  actions: LidarrPlanAction[];
  artistActions: LidarrPlanAction[];
  actionNames: string[];
  mutates: boolean;
  variousArtistsSkip: boolean;
  variousArtistsOverride: boolean;
}

export interface LidarrPlanSummary {
  actions: number;
  changes: number;
  artists: number;
  newArtists: number;
  releases: number;
  represented: number;
  monitored: number;
  searches: number;
  attention: number;
}

export function lidarrPlanSummary(plan: LidarrPlan): LidarrPlanSummary {
  return {
    actions: plan.actions.length,
    changes: plan.actions.filter((action) => mutatingActions.has(action.action)).length,
    artists: new Set(plan.actions.flatMap((action) => (action.artistMbid ? [action.artistMbid] : []))).size,
    newArtists: plan.actions.filter((action) => action.action === "create_artist").length,
    releases: new Set(plan.actions.flatMap((action) => (action.releaseGroupId ? [action.releaseGroupId] : []))).size,
    represented: plan.actions.filter((action) =>
      ["reuse_downloaded_release", "reuse_existing_release", "unchanged"].includes(action.action),
    ).length,
    monitored: plan.actions.filter((action) => action.action === "monitor_release").length,
    searches: plan.actions.filter((action) => action.action === "queue_search").length,
    attention: plan.actions.filter((action) => action.action === "skip").length,
  };
}

export function lidarrPlanRows(entries: LidarrPlanEntry[], plan: LidarrPlan): LidarrPlanRow[] {
  const actionsByGroup = new Map<string, LidarrPlanAction[]>();
  const actionsByArtist = new Map<string, LidarrPlanAction[]>();
  const reuseBySourceGroup = new Map<string, LidarrPlanAction[]>();

  for (const action of plan.actions) {
    if (action.releaseGroupId) append(actionsByGroup, action.releaseGroupId, action);
    else if (action.artistMbid) append(actionsByArtist, action.artistMbid, action);

    if (action.action === "reuse_downloaded_release")
      for (const group of strings(action.payload, "mapped_release_group_ids"))
        append(reuseBySourceGroup, group, action);
  }

  return entries.map((entry) => {
    const recordingIds = new Set(entry.result.recordingIds ?? []);
    const releases = (entry.result.releaseGroupIds ?? []).map((sourceGroup) => {
      const reuse = (reuseBySourceGroup.get(sourceGroup) ?? []).find((action) =>
        intersects(recordingIds, strings(action.payload, "requested_recording_ids")),
      );
      const lidarrGroup = reuse?.releaseGroupId ?? sourceGroup;
      const actions = (actionsByGroup.get(lidarrGroup) ?? []).filter((action) => {
        if (action.artistMbid && action.artistMbid !== entry.result.primaryArtistId) return false;
        const requested = strings(action.payload, "requested_recording_ids");
        return !requested.length || intersects(recordingIds, requested);
      });
      const displayedMatch = actions.find((action) => record(action.payload?.matched_track));
      const releaseArtist = actions.find((action) => action.artistName || action.artistMbid);
      return {
        sourceGroup,
        lidarrGroup,
        title: actions.find((action) => action.albumTitle)?.albumTitle ?? "",
        artistName: releaseArtist?.artistName ?? entry.result.artistNames?.[0] ?? "",
        actions,
        matchedTrack: record(displayedMatch?.payload?.matched_track),
        lidarrAlbumId: scalar(displayedMatch?.payload?.lidarr_album_id),
      };
    });
    const artistActions = actionsByArtist.get(entry.result.primaryArtistId ?? "") ?? [];
    const actions = unique([...artistActions, ...releases.flatMap((release) => release.actions)]);
    const actionNames = new Set(actions.map((action) => action.action));
    if (!actions.length && !entry.result.resolvedVia) actionNames.add("skip");

    return {
      entry,
      releases,
      actions,
      artistActions,
      actionNames: [...actionNames].sort(),
      mutates: [...actionNames].some((action) => mutatingActions.has(action)),
      variousArtistsSkip: actions.some((action) =>
        ["various_artists_album", "various_artists_skipped"].includes(action.reason ?? ""),
      ),
      variousArtistsOverride: Boolean(entry.evidence.allow_various_artists_release),
    };
  });
}

function append(values: Map<string, LidarrPlanAction[]>, key: string, action: LidarrPlanAction) {
  values.set(key, [...(values.get(key) ?? []), action]);
}

function strings(payload: Record<string, unknown> | undefined, key: string): string[] {
  const value = payload?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function intersects(left: Set<string>, right: string[]) {
  return right.some((value) => left.has(value));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function scalar(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function unique(actions: LidarrPlanAction[]) {
  return actions.filter((action, index) => actions.indexOf(action) === index);
}
