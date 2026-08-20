import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  allowVariousArtistsRelease,
  changePlannedRelease,
  preparePlanEntryRetry,
} from "../src/server/application/lidarr-plan-actions";
import { openDatabase } from "../src/server/persistence/database";
import { ImportRepository } from "../src/server/persistence/import-repository";
import { LidarrPlanRepository } from "../src/server/persistence/lidarr-plan-repository";
import { ResolutionRepository } from "../src/server/persistence/resolution-repository";

let directory: string;
let database: ReturnType<typeof openDatabase>;
let importId: string;
let entryId: number;
let planId: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "playlarr-lidarr-actions-"));
  database = openDatabase(path.join(directory, "music-importer.db"));
  const imports = new ImportRepository(database);
  importId = imports.createImport({
    source: "spotify",
    id: "mix",
    name: "Mix",
  }).id;
  imports.replaceTracks(importId, [
    {
      source: "spotify",
      sourceTrackId: "song",
      title: "Song",
      artists: ["Artist"],
      album: "Album",
    },
  ]);
  entryId = imports.entries(importId)[0].id;
  new ResolutionRepository(database).saveAutomatic(entryId, {
    resolvedVia: "isrc",
    recordingIds: ["recording"],
    releaseGroupIds: ["release-a", "release-b"],
  });
  planId = new LidarrPlanRepository(database).save(importId, {
    actions: [{ action: "skip", reason: "various_artists_album" }],
  });
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true });
});

it("persists a selected plan release as a confirmed manual mapping", () => {
  expect(changePlannedRelease(database, planId, entryId, "release-b")).toBe(
    importId,
  );
  expect(new ResolutionRepository(database).get(entryId)).toMatchObject({
    state: "manually_resolved",
    method: "manual_mbid",
    isManual: true,
    selectedReleaseGroupId: "release-b",
    result: { releaseGroupIds: ["release-b"] },
  });
  expect(new LidarrPlanRepository(database).get(planId).status).toBe(
    "superseded",
  );
});

it("rejects a release that was not persisted for the entry", () => {
  expect(() =>
    changePlannedRelease(database, planId, entryId, "unrelated-release"),
  ).toThrow("does not belong to this track");
});

it("persists the per-recording Various Artists override and supersedes the draft", () => {
  expect(allowVariousArtistsRelease(database, planId, entryId)).toBe(importId);
  expect(new ResolutionRepository(database).get(entryId).evidence).toEqual({
    allow_various_artists_release: true,
  });
  expect(new LidarrPlanRepository(database).get(planId).status).toBe(
    "superseded",
  );
});

it("retry clears a manual mapping only after validating plan ownership", () => {
  new ResolutionRepository(database).saveManual(
    entryId,
    { resolvedVia: "manual_mbid", recordingIds: ["recording"] },
    "manual_mbid",
    "valid",
  );
  expect(preparePlanEntryRetry(database, planId, entryId)).toBe(importId);
  expect(new ResolutionRepository(database).get(entryId)).toMatchObject({
    state: "pending",
    isManual: false,
    result: {},
  });
});
