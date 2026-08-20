import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../../server/persistence/database";
import { JobRepository } from "../../server/persistence/job-repository";
const paths: string[] = [];
afterEach(() =>
  paths.splice(0).forEach((value) => rmSync(value, { recursive: true })),
);
it("cancels queued work and retains cancellation requests for running work", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-jobs-"));
  paths.push(directory);
  const jobs = new JobRepository(
    openDatabase(path.join(directory, "music-importer.db")),
  );
  const queued = jobs.create("resolve");
  jobs.requestCancel(queued.id);
  expect(jobs.get(queued.id)).toMatchObject({
    status: "cancelled",
    cancelRequested: true,
  });
  const running = jobs.create("resolve");
  jobs.update(running.id, { status: "running" });
  jobs.requestCancel(running.id);
  expect(jobs.get(running.id)).toMatchObject({
    status: "running",
    cancelRequested: true,
    currentItem: "Cancellation requested",
  });
});
it("claims queued work once in creation order", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-jobs-"));
  paths.push(directory);
  const jobs = new JobRepository(
    openDatabase(path.join(directory, "music-importer.db")),
  );
  const first = jobs.create("first");
  jobs.create("second");
  expect(jobs.claimNext()?.id).toBe(first.id);
  expect(jobs.claimNext()?.kind).toBe("second");
  expect(jobs.claimNext()).toBeUndefined();
});
it("persists worker payloads in the schema-v8 result field", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-jobs-"));
  paths.push(directory);
  const database = openDatabase(path.join(directory, "music-importer.db"));
  database
    .prepare(
      "INSERT INTO imports (id, source, source_playlist_id, playlist_name, workflow_state, created_at, updated_at) VALUES ('import', 'spotify', 'list', 'List', 'ready_to_plan', 'now', 'now')",
    )
    .run();
  const jobs = new JobRepository(database);
  const job = jobs.create("lidarr_execution", "import", 1, { planId: "plan" });
  expect(jobs.get(job.id).payload).toEqual({ planId: "plan" });
});
