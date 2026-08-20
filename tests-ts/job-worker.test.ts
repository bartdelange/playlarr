import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DurableJobWorker } from "../src/server/jobs/worker";
import { openDatabase } from "../src/server/persistence/database";
import { JobRepository } from "../src/server/persistence/job-repository";
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
