import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { finalTableRows } from "../../server/application/final-table-view";
import {
  lidarrPlanRows,
  lidarrPlanSummary,
} from "../../server/application/lidarr-plan-view";
import { loadConfig } from "../../server/config/environment";
import { productionJobHandlers } from "../../server/jobs/handlers";
import { openDatabase } from "../../server/persistence/database";
import { ImportRepository } from "../../server/persistence/import-repository";
import { JobRepository } from "../../server/persistence/job-repository";
import { LidarrPlanRepository } from "../../server/persistence/lidarr-plan-repository";
import { SettingsRepository } from "../../server/persistence/settings-repository";

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true });
});

it("creates a master-equivalent persisted plan that feeds Lidarr, library, and Final projections", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-lidarr-chain-"));
  directories.push(directory);
  const database = openDatabase(path.join(directory, "state.db"));
  const imports = new ImportRepository(database);
  const imported = imports.createImport({
    source: "spotify",
    id: "production-chain",
    name: "Production chain",
  });
  const fixtures: {
    title: string;
    result: Record<string, unknown>;
    state?: string;
    method?: string;
  }[] = [
    resolution("downloaded", "artist-a", "group-a", "recording-a"),
    resolution("missing release", "artist-b", "group-b", "recording-b"),
    resolution("monitored missing", "artist-c", "group-c", "recording-c"),
    resolution("selected edition", "artist-d", "group-d", "recording-d", [
      "release-d",
    ]),
    resolution("global album", "artist-e", "group-e", "recording-e"),
    resolution("protected compilation", "artist-f", "group-f", "recording-f"),
    resolution("allowed compilation", "artist-g", "group-g", "recording-g"),
    resolution("title fallback", "artist-h", "group-h", "requested-h"),
    { title: "Skipped", result: {}, state: "skipped", method: "manual_skip" },
  ];
  fixtures[3].result.release_group_ids = ["alternate-d", "group-d"];
  imports.replaceTracks(
    imported.id,
    fixtures.map((fixture, position) => ({
      source: "spotify",
      sourceTrackId: `source-${position}`,
      title: fixture.title,
      artists: ["Source artist"],
      album: "Source album",
    })),
  );
  const entries = imports.entries(imported.id);
  const saveResolution = database.prepare(
    `UPDATE resolutions
     SET state = ?, method = ?, result_json = ?, evidence_json = ?, is_manual = ?
     WHERE entry_id = ?`,
  );
  fixtures.forEach((fixture, position) =>
    saveResolution.run(
      fixture.state ?? "automatically_resolved",
      fixture.method ?? "isrc",
      JSON.stringify(fixture.result),
      JSON.stringify(
        position === 6 ? { allow_various_artists_release: true } : {},
      ),
      fixture.state === "skipped" ? 1 : 0,
      entries[position].id,
    ),
  );
  database
    .prepare(
      "UPDATE resolutions SET selected_release_group_id = 'group-d' WHERE entry_id = ?",
    )
    .run(entries[3].id);

  vi.stubGlobal("fetch", vi.fn(lidarrTransport));
  const jobs = new JobRepository(database);
  const job = jobs.create("lidarr_planning", imported.id);
  const handler = productionJobHandlers(
    database,
    loadConfig({
      DATA_DIR: directory,
      OUTPUT_DIR: path.join(directory, "output"),
      MUSICBRAINZ_USER_AGENT: "Playlarr test",
      LIDARR_URL: "http://lidarr",
      LIDARR_API_KEY: "test",
    }),
    new SettingsRepository(database),
  ).lidarr_planning;

  await handler(job, vi.fn(), () => false);

  const plans = new LidarrPlanRepository(database);
  const header = database
    .prepare(
      "SELECT id FROM lidarr_plans WHERE import_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(imported.id) as { id: string };
  const plan = plans.get(header.id).plan;
  const downloaded = plan.actions.find(
    (action) =>
      action.action === "unchanged" && action.releaseGroupId === "group-a",
  );
  expect(downloaded).toMatchObject({
    albumTitle: "Downloaded album",
    reason: "requested_recording_downloaded",
    payload: {
      lidarr_album_id: 101,
      requested_recording_ids: ["recording-a"],
      matched_track: {
        id: 1001,
        foreign_recording_id: "recording-a",
        track_file_id: 5001,
        has_file: true,
        match_method: "recording_id",
      },
    },
  });
  expect(actionsFor(plan.actions, "group-b")).toEqual([
    "create_release",
    "monitor_release",
    "queue_search",
  ]);
  expect(actionsFor(plan.actions, "group-c")).toEqual([
    "unchanged",
    "queue_search",
  ]);
  expect(
    plan.actions.find(
      (action) =>
        action.action === "monitor_release" &&
        action.releaseGroupId === "group-d",
    )?.payload,
  ).toMatchObject({ requested_release_ids: ["release-d"] });
  expect(actionsFor(plan.actions, "group-e")).toContain(
    "reuse_existing_release",
  );
  expect(actionsFor(plan.actions, "group-f")).toEqual(["skip"]);
  expect(
    plan.actions
      .filter(
        (action) =>
          action.releaseGroupId === "group-g" &&
          ["monitor_release", "queue_search"].includes(action.action),
      )
      .every(
        (action) => action.payload?.allow_various_artists_release === true,
      ),
  ).toBe(true);
  expect(
    plan.actions.find(
      (action) =>
        action.action === "unchanged" && action.releaseGroupId === "group-h",
    )?.payload?.matched_track,
  ).toMatchObject({ id: 1008, match_method: "normalized_title" });
  expect(
    plan.actions.filter(
      (action) =>
        action.action === "skip" && action.reason === "musicbrainz_unresolved",
    ),
  ).toHaveLength(1);

  const resolutions = plans.planningResolutions(imported.id);
  expect(resolutions[3]).toMatchObject({
    selectedReleaseGroupId: "group-d",
    result: { releaseGroupIds: ["group-d"], releaseIds: ["release-d"] },
  });
  const libraryRows = database
    .prepare(
      `SELECT e.id, l.classification, l.file_path
       FROM playlist_entries e
       LEFT JOIN library_status l ON l.entry_id = e.id
       WHERE e.import_id = ? ORDER BY e.position`,
    )
    .all(imported.id) as {
    id: number;
    classification: string | null;
    file_path: string | null;
  }[];
  const planEntries = entries.map((entry, position) => ({
    id: entry.id,
    position: entry.position,
    resolutionState: entry.resolutionState,
    isManual: entry.isManual,
    track: entry.track,
    result: resolutions[position].result,
    evidence: resolutions[position].evidence,
    selectedReleaseGroupId: resolutions[position].selectedReleaseGroupId,
  }));
  const lidarrRows = lidarrPlanRows(planEntries, plan);
  expect(lidarrRows[0].releases[0]).toMatchObject({
    title: "Downloaded album",
    lidarrAlbumId: 101,
    matchedTrack: { id: 1001, track_file_id: 5001 },
  });
  expect(lidarrPlanSummary(plan)).toMatchObject({
    artists: 8,
    attention: 2,
  });

  const finalRows = finalTableRows(
    planEntries.map((entry, position) => ({
      id: entry.id,
      position: entry.position,
      resolutionState: entry.resolutionState,
      track: entry.track,
      result: entry.result,
      libraryClassification: libraryRows[position].classification ?? undefined,
      libraryPath: libraryRows[position].file_path ?? undefined,
    })),
    plan.actions,
  );
  expect(finalRows[0]).toMatchObject({
    availability: "downloaded",
    libraryPath: "/music/Artist A/Downloaded.flac",
    lidarrMatch: {
      title: "Downloaded",
      foreignRecordingId: "recording-a",
      trackFileId: 5001,
      albumTitle: "Downloaded album",
    },
  });
  expect(finalRows[2]).toMatchObject({ availability: "downloadable" });
  expect(finalRows[8]).toMatchObject({ availability: "not_downloadable" });
  database.close();
});

function resolution(
  title: string,
  artist: string,
  group: string,
  recording: string,
  releases: string[] = [],
) {
  return {
    title,
    result: {
      resolved_via: "isrc",
      recording_title: title,
      artist_names: [artist],
      recording_ids: [recording],
      release_ids: releases,
      release_group_ids: [group],
      primary_artist_id: artist,
    },
  };
}

function actionsFor(
  actions: { action: string; releaseGroupId?: string }[],
  group: string,
) {
  return actions
    .filter((action) => action.releaseGroupId === group)
    .map((action) => action.action);
}

async function lidarrTransport(input: string | URL | Request) {
  const url = new URL(String(input));
  const endpoint = url.pathname.replace("/api/v1/", "");
  if (endpoint === "artist")
    return Response.json(
      ["a", "b", "c", "d", "f", "g", "h"].map((suffix) => ({
        id: suffix.charCodeAt(0) - 96,
        foreignArtistId: `artist-${suffix}`,
        artistName: `Artist ${suffix.toUpperCase()}`,
        monitored: true,
        monitorNewItems: "none",
        path: `/music/Artist ${suffix.toUpperCase()}`,
      })),
    );
  if (endpoint === "album" && url.searchParams.has("artistId")) {
    const id = Number(url.searchParams.get("artistId"));
    const albums: Record<number, Record<string, unknown>[]> = {
      1: [album(101, 1, "group-a", "Downloaded album", true)],
      3: [album(103, 3, "group-c", "Monitored album", true)],
      4: [
        album(104, 4, "group-d", "Selected album", true, {
          anyReleaseOk: true,
          releases: [
            { foreignReleaseId: "other-d", monitored: true },
            { foreignReleaseId: "release-d", monitored: false },
          ],
        }),
      ],
      6: [compilation(106, 6, "group-f")],
      7: [compilation(107, 7, "group-g")],
      8: [album(108, 8, "group-h", "Fallback album", true)],
    };
    return Response.json(albums[id] ?? []);
  }
  if (endpoint === "album" && url.searchParams.has("foreignAlbumId")) {
    const group = url.searchParams.get("foreignAlbumId")!;
    if (group === "group-e")
      return Response.json([album(105, 99, group, "Global album", true)]);
    return Response.json([]);
  }
  if (endpoint === "track" && url.searchParams.has("artistId")) {
    const id = Number(url.searchParams.get("artistId"));
    if (id === 1)
      return Response.json([
        track(1001, 101, "Downloaded", "recording-a", 5001),
      ]);
    if (id === 3)
      return Response.json([
        track(1003, 103, "monitored missing", "recording-c"),
      ]);
    if (id === 8)
      return Response.json([
        track(1008, 108, "title fallback", "different-h", 5008),
      ]);
    return Response.json([]);
  }
  if (endpoint === "track" && url.searchParams.has("albumId"))
    return Response.json([]);
  if (endpoint === "trackFile") {
    const id = Number(url.searchParams.get("artistId"));
    if (id === 1)
      return Response.json([
        { id: 5001, path: "/music/Artist A/Downloaded.flac" },
      ]);
    if (id === 8)
      return Response.json([
        { id: 5008, path: "/music/Artist H/Fallback.flac" },
      ]);
    return Response.json([]);
  }
  if (endpoint === "album/lookup") {
    const group = url.searchParams.get("term")?.replace("lidarr:", "") ?? "";
    return Response.json([album(900, 0, group, `Lookup ${group}`, false)]);
  }
  throw new Error(`Unexpected Lidarr request: ${url}`);
}

function album(
  id: number,
  artistId: number,
  group: string,
  title: string,
  monitored: boolean,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    artistId,
    foreignAlbumId: group,
    title,
    monitored,
    artist: { id: artistId, foreignArtistId: `artist-${artistId}` },
    ...overrides,
  };
}

function compilation(id: number, artistId: number, group: string) {
  return album(id, artistId, group, "Compilation", false, {
    artist: {
      id: 99,
      foreignArtistId: "89ad4ac3-39f7-470e-963a-56509c546377",
      artistName: "Various Artists",
    },
  });
}

function track(
  id: number,
  albumId: number,
  title: string,
  recording: string,
  trackFileId?: number,
) {
  return {
    id,
    albumId,
    title,
    trackNumber: 1,
    foreignRecordingId: recording,
    trackFileId,
    hasFile: trackFileId !== undefined,
  };
}
