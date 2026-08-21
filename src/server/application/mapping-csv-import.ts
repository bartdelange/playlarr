import type { MusicBrainzResult } from "../domain/musicbrainz";
import type { SourceTrack } from "../domain/playlist";
import type { ImportRepository } from "../persistence/import-repository";
import type { ResolutionRepository } from "../persistence/resolution-repository";

export function importMappingCsv(
  csv: string,
  playlistName: string,
  imports: ImportRepository,
  resolutions: ResolutionRepository,
) {
  const rows = parseCsv(csv);
  if (!rows.length) throw new Error("cannot infer source playlist metadata from an empty mapping CSV");
  const source = rows[0].source?.trim() || "unknown";
  const playlistId = rows[0].source_playlist_id?.trim();
  if (!playlistId) throw new Error("mapping CSV has no source playlist ID");
  const existing = imports.findImport(source, playlistId);
  if (existing) return existing;
  const imported = imports.createImport(
    { source, id: playlistId, name: playlistName },
    { imported_from_csv: playlistName },
  );
  const tracks: SourceTrack[] = rows.map((row, position) => ({
    source,
    sourceTrackId: row.source_track_id || `csv:${position}`,
    title: row.track_title || "",
    artists: split(row.artists, ";"),
    album: row.album || "",
    isrc: row.isrc || undefined,
    durationMs: /^\d+$/.test(row.duration_ms || "") ? Number(row.duration_ms) : undefined,
  }));
  imports.replaceTracks(imported.id, tracks);
  const results = rows.map(mappingResult);
  imports.entries(imported.id).forEach((entry, index) => resolutions.saveImported(entry.id, results[index]));
  imports.setWorkflowState(
    imported.id,
    results.some((result) => !result.resolvedVia) ? "review_required" : "ready_to_plan",
  );
  return imports.getImport(imported.id);
}

function mappingResult(row: Record<string, string>): MusicBrainzResult {
  const resolvedVia = row.resolved_via && row.resolved_via !== "none" ? row.resolved_via : undefined;
  return {
    resolvedVia,
    recordingTitle: row.mb_recording_title || undefined,
    artistNames: split(row.mb_artist_names, ";"),
    recordingIds: split(row.mb_recording_ids, ";"),
    releaseIds: split(row.mb_release_ids, ";"),
    releaseGroupIds: split(row.mb_release_group_ids, ";"),
    artistIds: split(row.mb_artist_ids, ";"),
    primaryArtistId: row.mb_primary_artist_id || undefined,
    failureReason: row.failure_reason || undefined,
  };
}

function split(value = "", separator: string) {
  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseCsv(csv: string): Record<string, string>[] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      record.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      record.push(cell);
      if (record.some(Boolean)) records.push(record);
      record = [];
      cell = "";
    } else cell += character;
  }
  if (cell || record.length) {
    record.push(cell);
    records.push(record);
  }
  const [headers = [], ...rows] = records;
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}
