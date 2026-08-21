import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../../server/persistence/database";
import { planLidarr } from "../../server/application/lidarr-planning";
import { ImportRepository } from "../../server/persistence/import-repository";
import { LidarrPlanRepository } from "../../server/persistence/lidarr-plan-repository";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true })));
it("requires explicit approval and supersedes an earlier draft plan", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-plan-"));
  directories.push(directory);
  const database = openDatabase(path.join(directory, "music-importer.db"));
  const imported = new ImportRepository(database).createImport({
    source: "spotify",
    id: "mix",
    name: "Mix",
  });
  const plans = new LidarrPlanRepository(database);
  const first = plans.save(imported.id, {
    actions: [{ action: "create_artist", artistMbid: "artist" }],
  });
  const second = plans.save(imported.id, {
    actions: [{ action: "queue_search" }],
  });
  expect(plans.get(first).status).toBe("superseded");
  plans.approve(second);
  expect(plans.get(second)).toMatchObject({
    status: "approved",
    plan: { actions: [{ action: "queue_search" }] },
  });
  expect(() => plans.approve(first)).toThrow("only a current draft");
  database.close();
});
it("records execution only after approval and marks failures visibly", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-plan-"));
  directories.push(directory);
  const database = openDatabase(path.join(directory, "music-importer.db"));
  const imported = new ImportRepository(database).createImport({
    source: "spotify",
    id: "mix",
    name: "Mix",
  });
  const plans = new LidarrPlanRepository(database);
  const id = plans.save(imported.id, { actions: [] });
  expect(() => plans.recordExecution(id, [])).toThrow("only an approved");
  plans.approve(id);
  plans.recordExecution(id, [{ outcome: "failed", details: "Lidarr unavailable" }]);
  expect(plans.get(id).status).toBe("failed");
  expect(database.prepare("SELECT workflow_state FROM imports WHERE id = ?").pluck().get(imported.id)).toBe(
    "execution_failed",
  );
  database.close();
});
it("projects schema-v8 resolution MBIDs into Lidarr planning without making skipped rows eligible", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-plan-"));
  directories.push(directory);
  const database = openDatabase(path.join(directory, "music-importer.db"));
  const imports = new ImportRepository(database);
  const imported = imports.createImport({
    source: "spotify",
    id: "schema-v8",
    name: "Schema v8",
  });
  imports.replaceTracks(
    imported.id,
    ["manual", "automatic", "unresolved", "skipped"].map((id) => ({
      source: "spotify",
      sourceTrackId: id,
      title: id,
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
  update.run(
    "manually_resolved",
    "manual_mbid",
    JSON.stringify({
      resolved_via: "manual_mbid",
      recording_title: "Manual recording",
      artist_names: ["Manual artist"],
      recording_ids: ["manual-recording"],
      release_ids: ["manual-release"],
      release_group_ids: ["manual-group"],
      artist_ids: ["manual-artist"],
      primary_artist_id: "manual-artist",
    }),
    1,
    entries[0].id,
  );
  update.run(
    "automatically_resolved",
    "isrc",
    JSON.stringify({
      resolved_via: "isrc",
      recording_title: "Automatic recording",
      artist_names: ["Automatic artist"],
      recording_ids: ["automatic-recording"],
      release_group_ids: ["automatic-group"],
      primary_artist_id: "automatic-artist",
    }),
    0,
    entries[1].id,
  );
  update.run("unresolved", null, "{}", 0, entries[2].id);
  update.run("skipped", "manual_skip", "{}", 1, entries[3].id);

  const resolutions = new LidarrPlanRepository(database).planningResolutions(imported.id);
  expect(resolutions.map((resolution) => resolution.result)).toEqual([
    expect.objectContaining({
      resolvedVia: "manual_mbid",
      recordingIds: ["manual-recording"],
      releaseGroupIds: ["manual-group"],
      primaryArtistId: "manual-artist",
    }),
    expect.objectContaining({
      resolvedVia: "isrc",
      recordingIds: ["automatic-recording"],
      releaseGroupIds: ["automatic-group"],
      primaryArtistId: "automatic-artist",
    }),
    expect.objectContaining({
      recordingIds: [],
      releaseGroupIds: [],
      primaryArtistId: undefined,
    }),
    expect.objectContaining({
      recordingIds: [],
      releaseGroupIds: [],
      primaryArtistId: undefined,
    }),
  ]);

  const plan = await planLidarr(
    resolutions.map((resolution) => resolution.result),
    {
      artists: async () => [],
      albumsByArtistId: async () => [],
      albumsByForeignId: async () => [],
      tracksByArtistId: async () => [],
      tracksByAlbumId: async () => [],
      lookup: async () => undefined,
    },
  );
  expect(plan.actions.filter((action) => action.action === "create_artist")).toEqual([
    expect.objectContaining({ artistMbid: "manual-artist" }),
    expect.objectContaining({ artistMbid: "automatic-artist" }),
  ]);
  expect(
    plan.actions.filter((action) => action.action === "skip" && action.reason === "musicbrainz_unresolved"),
  ).toHaveLength(2);
  database.close();
});

it("restores schema-v8 persisted plan action fields without changing superseded status", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-plan-"));
  directories.push(directory);
  const database = openDatabase(path.join(directory, "music-importer.db"));
  const imported = new ImportRepository(database).createImport({
    source: "spotify",
    id: "legacy-plan",
    name: "Legacy plan",
  });
  const plans = new LidarrPlanRepository(database);
  const first = plans.save(imported.id, { actions: [] });
  database.prepare("INSERT INTO lidarr_plan_actions (plan_id, position, action_json) VALUES (?, 0, ?)").run(
    first,
    JSON.stringify({
      action: "monitor_release",
      artist_mbid: "artist",
      artist_name: "Artist",
      release_group_id: "group",
      album_title: "Album",
      reason: "requested_track_missing",
      payload: { requested_recording_ids: ["recording"] },
    }),
  );
  plans.save(imported.id, { actions: [] });

  expect(plans.get(first)).toMatchObject({
    status: "superseded",
    plan: {
      actions: [
        {
          action: "monitor_release",
          artistMbid: "artist",
          artistName: "Artist",
          releaseGroupId: "group",
          albumTitle: "Album",
          payload: { requested_recording_ids: ["recording"] },
        },
      ],
    },
  });
  database.close();
});
