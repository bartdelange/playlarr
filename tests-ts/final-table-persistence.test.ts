import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  filterFinalRows,
  finalAvailabilityCounts,
  finalTableRows,
} from "../src/server/application/final-table-view";
import { openDatabase } from "../src/server/persistence/database";
import { ImportRepository } from "../src/server/persistence/import-repository";
import { LibraryRepository } from "../src/server/persistence/library-repository";
import { LidarrPlanRepository } from "../src/server/persistence/lidarr-plan-repository";

const directories: string[] = [];

afterEach(() => {
  directories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true }));
});

it("projects persisted schema-v8 Lidarr matches independently from library availability", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-final-"));
  directories.push(directory);
  const database = openDatabase(path.join(directory, "music-importer.db"));
  const imports = new ImportRepository(database);
  const imported = imports.createImport({
    source: "spotify",
    id: "final-projection",
    name: "Final projection",
  });
  imports.replaceTracks(
    imported.id,
    ["automatic", "manual", "missing", "unresolved"].map((id) => ({
      source: "spotify",
      sourceTrackId: id,
      title: `Source ${id}`,
      artists: ["Source artist"],
      album: "Source album",
    })),
  );
  const entries = imports.entries(imported.id);
  const update = database.prepare(
    `UPDATE resolutions
     SET state = ?, method = ?, result_json = ?, is_manual = ?
     WHERE entry_id = ?`,
  );
  const resolved = (
    resolvedVia: string,
    recording: string,
    artist: string,
    group: string,
  ) =>
    JSON.stringify({
      resolved_via: resolvedVia,
      recording_title: `${recording} title`,
      artist_names: [`${artist} name`],
      recording_ids: [recording],
      release_group_ids: [group],
      primary_artist_id: artist,
    });
  update.run(
    "automatically_resolved",
    "isrc",
    resolved(
      "isrc",
      "automatic-recording",
      "automatic-artist",
      "automatic-group",
    ),
    0,
    entries[0].id,
  );
  update.run(
    "manually_resolved",
    "manual_mbid",
    resolved(
      "manual_mbid",
      "manual-recording",
      "manual-artist",
      "manual-group",
    ),
    1,
    entries[1].id,
  );
  update.run(
    "manually_resolved",
    "manual_search",
    resolved(
      "manual_search",
      "missing-recording",
      "missing-artist",
      "missing-group",
    ),
    1,
    entries[2].id,
  );
  update.run("unresolved", null, "{}", 0, entries[3].id);

  new LibraryRepository(database).saveStatus(imported.id, [
    {
      position: 0,
      classification: "represented_locally",
      path: "/music/Automatic/Track.flac",
    },
    {
      position: 1,
      classification: "recording_match",
      path: "/music/Manual/Track.flac",
    },
    { position: 2, classification: "release_monitored_missing" },
    { position: 3, classification: "musicbrainz_unresolved" },
  ]);
  const plans = new LidarrPlanRepository(database);
  const planId = plans.save(imported.id, {
    actions: [
      {
        action: "unchanged",
        artistMbid: "automatic-artist",
        releaseGroupId: "automatic-group",
        albumTitle: "Automatic album",
        payload: {
          requested_recording_ids: ["automatic-recording"],
          matched_track: {
            id: 10,
            title: "Automatic Lidarr track",
            track_number: 2,
            foreign_recording_id: "automatic-recording",
            track_file_id: 100,
            has_file: true,
            match_method: "recording_id",
          },
        },
      },
      {
        action: "reuse_downloaded_release",
        artistMbid: "manual-artist",
        releaseGroupId: "manual-lidarr-group",
        albumTitle: "Manual album",
        payload: {
          requested_recording_ids: ["manual-recording"],
          mapped_release_group_ids: ["manual-group"],
          matched_track: {
            id: 11,
            title: "Manual Lidarr track",
            track_number: 5,
            foreign_recording_id: "manual-recording",
            track_file_id: 101,
            has_file: true,
            match_method: "recording_id",
          },
        },
      },
      {
        action: "monitor_release",
        artistMbid: "missing-artist",
        releaseGroupId: "missing-group",
        albumTitle: "Monitored album",
        payload: { requested_recording_ids: ["missing-recording"] },
      },
    ],
  });
  const resolutions = new Map(
    plans
      .planningResolutions(imported.id)
      .map((resolution) => [resolution.entryId, resolution.result]),
  );
  const library = new Map(
    (
      database
        .prepare(
          `SELECT e.id, l.classification, l.file_path
           FROM playlist_entries e
           JOIN library_status l ON l.entry_id = e.id
           WHERE e.import_id = ?`,
        )
        .all(imported.id) as {
        id: number;
        classification: string;
        file_path: string | null;
      }[]
    ).map((row) => [row.id, row]),
  );

  const rows = finalTableRows(
    imports.entries(imported.id).map((entry) => ({
      id: entry.id,
      position: entry.position,
      resolutionState: entry.resolutionState,
      track: entry.track,
      result: resolutions.get(entry.id) ?? {},
      libraryClassification: library.get(entry.id)?.classification,
      libraryPath: library.get(entry.id)?.file_path ?? undefined,
    })),
    plans.get(planId).plan.actions,
  );

  expect(rows[0]).toMatchObject({
    resolutionState: "automatically_resolved",
    availability: "downloaded",
    libraryPath: "/music/Automatic/Track.flac",
    lidarrMatch: {
      title: "Automatic Lidarr track",
      foreignRecordingId: "automatic-recording",
      trackFileId: 100,
      albumTitle: "Automatic album",
      releaseGroupId: "automatic-group",
    },
  });
  expect(rows[1]).toMatchObject({
    resolutionState: "manually_resolved",
    availability: "downloaded",
    lidarrMatch: {
      title: "Manual Lidarr track",
      foreignRecordingId: "manual-recording",
      trackFileId: 101,
      albumTitle: "Manual album",
      releaseGroupId: "manual-lidarr-group",
    },
  });
  expect(rows[2]).toMatchObject({
    resolutionState: "manually_resolved",
    availability: "downloadable",
    lidarrMatch: undefined,
  });
  expect(rows[3]).toMatchObject({
    resolutionState: "unresolved",
    availability: "not_downloadable",
    lidarrMatch: undefined,
  });
  expect(finalAvailabilityCounts(rows)).toEqual({
    downloaded: 2,
    downloadable: 1,
    not_downloadable: 1,
  });
  expect(filterFinalRows(rows, "downloaded")).toHaveLength(2);
  expect(filterFinalRows(rows, "downloadable")).toHaveLength(1);
  expect(filterFinalRows(rows, "not_downloadable")).toHaveLength(1);
  database.close();
});
