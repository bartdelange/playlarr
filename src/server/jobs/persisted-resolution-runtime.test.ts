import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { normalizeMusicBrainzResult } from "../../server/domain/musicbrainz";
import { loadConfig } from "../../server/config/environment";
import { productionJobHandlers } from "../../server/jobs/handlers";
import { openDatabase } from "../../server/persistence/database";
import { ImportRepository } from "../../server/persistence/import-repository";
import { JobRepository } from "../../server/persistence/job-repository";
import { LibraryRepository } from "../../server/persistence/library-repository";
import { ResolutionRepository } from "../../server/persistence/resolution-repository";
import { SettingsRepository } from "../../server/persistence/settings-repository";

const paths: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  paths.splice(0).forEach((value) => rmSync(value, { recursive: true }));
});

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-runtime-"));
  paths.push(directory);
  const database = openDatabase(path.join(directory, "state.db"));
  const config = loadConfig({
    DATA_DIR: directory,
    OUTPUT_DIR: path.join(directory, "output"),
    MUSICBRAINZ_USER_AGENT: "Playlarr test",
    LIDARR_URL: "http://lidarr.test",
    LIDARR_API_KEY: "key",
    LIDARR_QUALITY_PROFILE_ID: "1",
    LIDARR_METADATA_PROFILE_ID: "1",
  });
  const imports = new ImportRepository(database);
  const imported = imports.createImport({
    source: "spotify",
    id: "playlist",
    name: "Runtime parity",
  });
  imports.replaceTracks(imported.id, [
    {
      source: "spotify",
      sourceTrackId: "automatic",
      title: "Automatic",
      artists: ["Artist"],
      album: "Album",
    },
    {
      source: "spotify",
      sourceTrackId: "manual",
      title: "Manual",
      artists: ["Artist"],
      album: "Album",
    },
  ]);
  const entries = imports.entries(imported.id);
  const update = database.prepare(
    "UPDATE resolutions SET state = ?, method = ?, result_json = ?, is_manual = ? WHERE entry_id = ?",
  );
  update.run(
    "automatically_resolved",
    "isrc",
    JSON.stringify({
      resolved_via: "isrc",
      recording_title: "Automatic",
      artist_names: ["Artist"],
      recording_ids: ["recording-auto"],
      release_group_ids: ["release-group"],
      primary_artist_id: "artist",
    }),
    0,
    entries[0].id,
  );
  update.run(
    "manually_resolved",
    "manual_mbid",
    JSON.stringify({
      resolved_via: "manual_mbid",
      recording_title: "Manual",
      artist_names: ["Artist"],
      recording_ids: ["recording-manual"],
      release_group_ids: ["release-group"],
      primary_artist_id: "artist",
    }),
    1,
    entries[1].id,
  );
  return { database, config, imported, entries };
}

it("normalizes legacy and current MusicBrainz result field names", () => {
  expect(
    normalizeMusicBrainzResult({
      resolved_via: "manual_mbid",
      recording_ids: ["legacy"],
      primary_artist_id: "artist",
    }),
  ).toMatchObject({
    resolvedVia: "manual_mbid",
    recordingIds: ["legacy"],
    primaryArtistId: "artist",
  });
  expect(
    normalizeMusicBrainzResult({
      resolvedVia: "isrc",
      recordingIds: ["current"],
      primaryArtistId: "artist",
    }),
  ).toMatchObject({
    resolvedVia: "isrc",
    recordingIds: ["current"],
    primaryArtistId: "artist",
  });
});

it("recognizes schema-v8 resolved rows in the library-status worker", async () => {
  const { database, config, imported, entries } = fixture();
  const resolutions = new ResolutionRepository(database);
  expect(resolutions.get(entries[0].id)).toMatchObject({
    state: "automatically_resolved",
    result: { resolvedVia: "isrc", recordingIds: ["recording-auto"] },
  });
  expect(resolutions.get(entries[1].id)).toMatchObject({
    state: "manually_resolved",
    result: {
      resolvedVia: "manual_mbid",
      recordingIds: ["recording-manual"],
    },
  });
  new ImportRepository(database).setWorkflowState(imported.id, "waiting_for_downloads");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/artist")) return Response.json([{ id: 7, foreignArtistId: "artist" }]);
      if (url.includes("trackFile?artistId=7")) return Response.json([]);
      if (url.includes("track?artistId=7")) return Response.json([]);
      if (url.includes("album?foreignAlbumId=release-group")) return Response.json([]);
      throw new Error(`unexpected Lidarr request: ${url}`);
    }),
  );
  const jobs = new JobRepository(database);
  const job = jobs.create("library_status", imported.id);
  const handler = productionJobHandlers(database, config, new SettingsRepository(database)).library_status;

  await handler(job, vi.fn(), () => false);

  expect(
    database
      .prepare(
        "SELECT classification FROM library_status l JOIN playlist_entries e ON e.id = l.entry_id WHERE e.import_id = ?",
      )
      .all(imported.id),
  ).toHaveLength(2);
  database.close();
});

it("generates a playlist from the same schema-v8 resolution rows", async () => {
  const { database, config, imported, entries } = fixture();
  new ImportRepository(database).setWorkflowState(imported.id, "library_status");
  new LibraryRepository(database).saveStatus(imported.id, [
    {
      position: 0,
      classification: "represented_locally",
      path: "/music/Automatic.flac",
    },
    { position: 1, classification: "release_monitored_missing" },
  ]);
  const jobs = new JobRepository(database);
  const job = jobs.create("playlist_generation", imported.id);
  const handler = productionJobHandlers(database, config, new SettingsRepository(database)).playlist_generation;

  await handler(job, vi.fn(), () => false);

  expect(readFileSync(path.join(config.outputDir, "Runtime-parity.m3u8"), "utf8")).toContain("/music/Automatic.flac");
  expect(new LibraryRepository(database).latestExport(imported.id)).toMatchObject({
    writtenTracks: 1,
    missingTracks: 1,
  });
  expect(entries).toHaveLength(2);
  database.close();
});
