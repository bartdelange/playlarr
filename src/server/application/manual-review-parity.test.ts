import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  confirmManualResolution,
  prepareAutomaticRetry,
  reusePreviousResolution,
  reviewDecisionDestination,
} from "../../server/application/manual-review";
import type {
  Candidate,
  ManualValidation,
} from "../../server/integrations/musicbrainz/candidates";
import { openDatabase } from "../../server/persistence/database";
import { ImportRepository } from "../../server/persistence/import-repository";
import { JobRepository } from "../../server/persistence/job-repository";
import { LidarrPlanRepository } from "../../server/persistence/lidarr-plan-repository";
import { ResolutionRepository } from "../../server/persistence/resolution-repository";

const paths: string[] = [];
afterEach(() =>
  paths.splice(0).forEach((value) => rmSync(value, { recursive: true })),
);

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-review-"));
  paths.push(directory);
  const database = openDatabase(path.join(directory, "state.db"));
  const imports = new ImportRepository(database);
  const imported = imports.createImport({
    source: "spotify",
    id: "playlist",
    name: "Review playlist",
  });
  imports.replaceTracks(imported.id, [
    {
      source: "spotify",
      sourceTrackId: "one",
      title: "First",
      artists: ["Artist"],
      album: "Album",
      isrc: "MATCH",
    },
    {
      source: "spotify",
      sourceTrackId: "two",
      title: "Second",
      artists: ["Artist"],
      album: "Album",
    },
  ]);
  const entries = imports.entries(imported.id);
  const resolutions = new ResolutionRepository(database);
  entries.forEach((entry) => resolutions.saveAutomatic(entry.id, {}));
  imports.setWorkflowState(imported.id, "review_required");
  return { database, imports, imported, entries, resolutions };
}

function validation(
  status: "valid" | "warning" = "valid",
  groups = ["group"],
): ManualValidation {
  const candidate: Candidate = {
    result: {
      resolvedVia: "manual_search",
      recordingTitle: "Matched recording",
      artistNames: ["Artist"],
      recordingIds: ["recording"],
      releaseIds: ["release"],
      releaseGroupIds: groups,
      artistIds: ["artist"],
      primaryArtistId: "artist",
    },
    isrcs: ["MATCH"],
    releases: groups.map((group) => ({
      id: "release",
      title: "Album",
      date: "2024",
      releaseGroupId: group,
      releaseGroupTitle: "Album",
      primaryType: "Album",
      secondaryTypes: [],
    })),
    score: 225,
    evidence: {
      titleSimilarity: status === "warning" ? 0.2 : 1,
      artistMatch: true,
      isrcMatch: true,
      sourceTitle: "First",
      candidateTitle: "Matched recording",
      sourceArtists: ["Artist"],
      candidateArtists: ["Artist"],
      versionPreference: 0,
    },
  };
  return {
    status,
    candidate,
    warnings: status === "warning" ? ["title_differs"] : [],
    errors: [],
  };
}

it("preserves manual search and manual MBID persistence methods", () => {
  const { database, entries, resolutions } = setup();
  confirmManualResolution(
    resolutions,
    entries[0].id,
    validation(),
    "manual_search",
    false,
  );
  confirmManualResolution(
    resolutions,
    entries[1].id,
    validation(),
    "manual_mbid",
    false,
  );

  expect(resolutions.get(entries[0].id)).toMatchObject({
    state: "manually_resolved",
    method: "manual_search",
    isManual: true,
  });
  expect(resolutions.get(entries[1].id)).toMatchObject({
    state: "manually_resolved",
    method: "manual_mbid",
    isManual: true,
  });
  database.close();
});

it("requires warning acknowledgement and an explicit ambiguous release group", () => {
  const { database, entries, resolutions } = setup();
  expect(() =>
    confirmManualResolution(
      resolutions,
      entries[0].id,
      validation("warning", ["one", "two"]),
      "manual_mbid",
      false,
    ),
  ).toThrow("explicit confirmation");
  expect(() =>
    confirmManualResolution(
      resolutions,
      entries[0].id,
      validation("warning", ["one", "two"]),
      "manual_mbid",
      true,
    ),
  ).toThrow("select a release group");

  confirmManualResolution(
    resolutions,
    entries[0].id,
    validation("warning", ["one", "two"]),
    "manual_mbid",
    true,
    "two",
  );
  expect(resolutions.get(entries[0].id)).toMatchObject({
    method: "manual_mbid",
    validationStatus: "warning",
    selectedReleaseGroupId: "two",
    result: { releaseGroupIds: ["two"] },
  });
  database.close();
});

it("supports session navigation, skip, and clear override", () => {
  const { database, imported, entries, resolutions } = setup();
  expect(resolutions.reviewQueue(imported.id).map((entry) => entry.id)).toEqual(
    entries.map((entry) => entry.id),
  );
  resolutions.markSkipped(entries[0].id);
  resolutions.updateReviewWorkflow(imported.id);
  expect(reviewDecisionDestination(resolutions, entries[0].id, true)).toBe(
    `/entries/${entries[1].id}/review?session=true`,
  );
  expect(resolutions.get(entries[0].id)).toMatchObject({
    state: "skipped",
    method: "manual_skip",
    isManual: true,
  });
  resolutions.clearManual(entries[0].id);
  resolutions.updateReviewWorkflow(imported.id);
  expect(resolutions.get(entries[0].id)).toMatchObject({
    state: "pending",
    method: undefined,
    isManual: false,
  });
  database.close();
});

it("reuses only a persisted previous manual mapping", () => {
  const { database, imported, entries, resolutions, imports } = setup();
  const source = imports.createImport({
    source: "spotify",
    id: "source",
    name: "Previous playlist",
  });
  imports.replaceTracks(source.id, [
    {
      ...entries[0].track,
      sourceTrackId: "different-source-id",
      isrc: "MATCH",
    },
  ]);
  const sourceEntry = imports.entries(source.id)[0];
  resolutions.saveManual(
    sourceEntry.id,
    validation().candidate!.result,
    "manual_mbid",
    "valid",
  );

  expect(resolutions.manualMatchSuggestions(entries[0].id)[0]).toMatchObject({
    entryId: sourceEntry.id,
    playlistName: "Previous playlist",
  });
  reusePreviousResolution(resolutions, entries[0].id, sourceEntry.id);
  expect(resolutions.get(entries[0].id)).toMatchObject({
    method: "reused_manual",
    result: { recordingIds: ["recording"] },
    evidence: { reused_from_playlist: "Previous playlist" },
  });
  expect(imports.getImport(imported.id).workflowState).toBe("ready_to_plan");
  database.close();
});

it("returns planned edits to Lidarr, supersedes the draft, and prepares retry", () => {
  const { database, imported, entries, resolutions } = setup();
  const plans = new LidarrPlanRepository(database);
  const planId = plans.save(imported.id, { actions: [] });
  confirmManualResolution(
    resolutions,
    entries[0].id,
    validation(),
    "manual_mbid",
    false,
  );
  expect(plans.get(planId).status).toBe("superseded");
  expect(
    reviewDecisionDestination(resolutions, entries[0].id, false, planId),
  ).toBe(`/imports/${imported.id}?stage=lidarr`);

  const retry = prepareAutomaticRetry(
    resolutions,
    new JobRepository(database),
    entries[0].id,
    planId,
  );
  expect(retry).toMatchObject({
    kind: "resolution_retry",
    importId: imported.id,
    payload: { entryId: entries[0].id },
  });
  expect(resolutions.get(entries[0].id).isManual).toBe(false);
  database.close();
});
