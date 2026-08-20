import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DurableJobWorker } from "../../server/jobs/worker";
import { productionJobHandlers } from "../../server/jobs/handlers";
import { loadConfig } from "../../server/config/environment";
import { openDatabase } from "../../server/persistence/database";
import { JobRepository } from "../../server/persistence/job-repository";
import { SettingsRepository } from "../../server/persistence/settings-repository";
const paths: string[] = [];
afterEach(() =>
  paths.splice(0).forEach((value) => rmSync(value, { recursive: true })),
);
it("runs one durable job with persisted progress and completion", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-worker-"));
  paths.push(directory);
  const jobs = new JobRepository(
    openDatabase(path.join(directory, "state.db")),
  );
  const job = jobs.create("resolve", undefined, 3);
  const handler = vi.fn(async (_job, progress) => progress(2, 3, "Song"));
  await new DurableJobWorker(jobs, { resolve: handler }).runOnce();
  expect(jobs.get(job.id)).toMatchObject({
    status: "completed",
    current: 2,
    total: 3,
    currentItem: "Song",
  });
});
it("never reclaims an interrupted mutation after restart", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-worker-"));
  paths.push(directory);
  const file = path.join(directory, "state.db");
  const database = openDatabase(file);
  const original = new JobRepository(database);
  const job = original.create("lidarr_execution");
  expect(original.claimNext()?.status).toBe("running");
  database.close();
  const restarted = new JobRepository(openDatabase(file));
  const handler = vi.fn();
  expect(
    await new DurableJobWorker(restarted, {
      lidarr_execution: handler,
    }).runOnce(),
  ).toBe(false);
  expect(restarted.get(job.id).status).toBe("interrupted");
  expect(handler).not.toHaveBeenCalled();
});
it("registers every durable workflow job used by the web application", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-worker-"));
  paths.push(directory);
  const database = openDatabase(path.join(directory, "state.db"));
  const handlers = productionJobHandlers(
    database,
    loadConfig({
      DATA_DIR: directory,
      OUTPUT_DIR: path.join(directory, "playlists"),
      MUSICBRAINZ_USER_AGENT: "Playlarr test",
      LIDARR_QUALITY_PROFILE_ID: "1",
      LIDARR_METADATA_PROFILE_ID: "1",
    }),
    new SettingsRepository(database),
  );

  expect(Object.keys(handlers).sort()).toEqual(
    [
      "playlist_catalogue",
      "playlist_acquisition",
      "playlist_analysis",
      "playlist_update_preview",
      "playlist_update",
      "resolution",
      "resolution_retry",
      "lidarr_planning",
      "lidarr_execution",
      "library_status",
      "playlist_generation",
    ].sort(),
  );
});
