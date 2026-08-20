import type { MusicBrainzResult } from "../domain/musicbrainz";
import type { SourceTrack, StoredEntry } from "../domain/playlist";
export interface TrackResolver {
  resolve(track: SourceTrack): Promise<MusicBrainzResult>;
}
export interface ResolutionWorkflowRepository {
  entries(importId: string): StoredEntry[];
  setWorkflowState(importId: string, state: string): void;
  markResolving(entryId: number): boolean;
  saveAutomatic(entryId: number, result: MusicBrainzResult): boolean;
}
export interface ResolutionSummary {
  total: number;
  resolvedByIsrc: number;
  resolvedBySearch: number;
  unresolved: number;
}
export async function resolveImport(
  repository: ResolutionWorkflowRepository,
  importId: string,
  resolver: TrackResolver,
  cancelled: () => boolean = () => false,
): Promise<ResolutionSummary> {
  const entries = repository.entries(importId);
  const summary: ResolutionSummary = {
    total: entries.length,
    resolvedByIsrc: 0,
    resolvedBySearch: 0,
    unresolved: 0,
  };
  repository.setWorkflowState(importId, "resolving");
  for (const entry of entries) {
    if (cancelled()) {
      repository.setWorkflowState(importId, "resolution_interrupted");
      return summary;
    }
    if (
      entry.resolutionState === "skipped" ||
      entry.isManual ||
      !repository.markResolving(entry.id)
    )
      continue;
    const result = await resolver.resolve(entry.track);
    repository.saveAutomatic(entry.id, result);
    if (result.resolvedVia === "isrc") summary.resolvedByIsrc++;
    else if (result.resolvedVia) summary.resolvedBySearch++;
    else summary.unresolved++;
  }
  repository.setWorkflowState(
    importId,
    summary.unresolved ? "review_required" : "ready_to_plan",
  );
  return summary;
}
