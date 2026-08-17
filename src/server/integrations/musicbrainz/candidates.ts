import type { SourceTrack } from "../../domain/playlist";
import { nameKey, searchTitle, sequenceSimilarity, uniqueValues, versionPreference, words } from "./matching";
import { resultFromRecordings, type MusicBrainzRecording } from "./resolution";

export interface CandidateRelease { id: string; title: string; date: string; releaseGroupId: string; releaseGroupTitle: string; primaryType: string; secondaryTypes: string[] }
export interface Candidate {
  result: NonNullable<ReturnType<typeof resultFromRecordings>>; durationMs?: number; isrcs: string[]; releases: CandidateRelease[]; score: number;
  evidence: { titleSimilarity: number; artistMatch: boolean; isrcMatch: boolean; durationDeltaMs?: number; sourceTitle: string; candidateTitle: string; sourceArtists: string[]; candidateArtists: string[]; versionPreference: number };
}
export interface ManualValidation { status: "valid" | "warning" | "invalid"; candidate?: Candidate; warnings: string[]; errors: string[] }

export function candidateFromRecording(track: SourceTrack, recording: MusicBrainzRecording): Candidate | undefined {
  let result = resultFromRecordings([recording], "manual_search", track.album);
  if (!result) return undefined;
  const candidateTitle = recording.title ?? "";
  const titleSimilarity = sequenceSimilarity(searchTitle(track.title).toLowerCase(), searchTitle(candidateTitle).toLowerCase());
  const sourceArtistKeys = new Set(track.artists.map(nameKey));
  const artistMatch = (result.artistNames ?? []).map(nameKey).some((name) => sourceArtistKeys.has(name));
  const isrcs = uniqueValues(recording.isrcs ?? []);
  const normalizedIsrc = (track.isrc ?? "").replace(/-/g, "").toUpperCase();
  const isrcMatch = Boolean(normalizedIsrc && isrcs.includes(normalizedIsrc));
  const releases = (recording.releases ?? []).map((release) => ({ id: release.id ?? "", title: release.title ?? "", date: release.date ?? "", releaseGroupId: release["release-group"]?.id ?? "", releaseGroupTitle: release["release-group"]?.title ?? "", primaryType: release["release-group"]?.["primary-type"] ?? "", secondaryTypes: release["release-group"]?.["secondary-types"] ?? [] }));
  const releaseGroupIds = uniqueValues(releases.map((release) => release.releaseGroupId));
  if (releaseGroupIds.length) result = { ...result, releaseIds: uniqueValues(releases.map((release) => release.id)), releaseGroupIds };
  const durationDeltaMs = recording.length !== undefined && track.durationMs !== undefined ? recording.length - track.durationMs : undefined;
  return { result, durationMs: recording.length, isrcs, releases, score: Number(recording.score ?? 0) + titleSimilarity * 25 + (artistMatch ? 100 : 0) + (isrcMatch ? 1000 : 0), evidence: { titleSimilarity: Math.round(titleSimilarity * 10_000) / 10_000, artistMatch, isrcMatch, durationDeltaMs, sourceTitle: track.title, candidateTitle, sourceArtists: [...track.artists], candidateArtists: [...(result.artistNames ?? [])], versionPreference: versionPreference(candidateTitle) } };
}

function rank(candidate: Candidate): number[] {
  const source = words(candidate.evidence.sourceTitle); const target = words(candidate.evidence.candidateTitle);
  const sameBase = source.size > 0 && source.size === target.size && [...source].every((word) => target.has(word));
  return [Number(candidate.evidence.isrcMatch), Number(candidate.evidence.artistMatch), Number(sameBase), sameBase ? versionPreference(candidate.evidence.candidateTitle) : 0, candidate.score];
}
export function candidates(track: SourceTrack, recordings: MusicBrainzRecording[]): Candidate[] {
  return recordings.flatMap((recording) => candidateFromRecording(track, recording) ?? []).sort((left, right) => { const a = rank(left); const b = rank(right); for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return b[index] - a[index]; return 0; });
}
export function validationWarnings(candidate: Candidate): string[] {
  const warnings: string[] = [];
  if (!candidate.evidence.artistMatch) warnings.push("artist_differs");
  if (candidate.evidence.titleSimilarity < 0.55) warnings.push("title_differs");
  if (candidate.evidence.durationDeltaMs !== undefined && Math.abs(candidate.evidence.durationDeltaMs) > 10_000) warnings.push("duration_differs");
  if (!candidate.evidence.isrcMatch && candidate.isrcs.length) warnings.push("isrc_differs");
  if (!candidate.result.releaseGroupIds?.length) warnings.push("release_group_missing"); else if (candidate.result.releaseGroupIds.length > 1) warnings.push("release_group_ambiguous");
  return warnings;
}
export function validateCandidate(candidate: Candidate): "valid" | "warning" { return validationWarnings(candidate).length ? "warning" : "valid"; }
