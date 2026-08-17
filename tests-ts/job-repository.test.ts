import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/server/persistence/database";
import { JobRepository } from "../src/server/persistence/job-repository";
const paths: string[] = []; afterEach(() => paths.splice(0).forEach((value) => rmSync(value, { recursive: true })));
it("cancels queued work and retains cancellation requests for running work", () => { const directory = mkdtempSync(path.join(tmpdir(), "playlarr-jobs-")); paths.push(directory); const jobs = new JobRepository(openDatabase(path.join(directory, "music-importer.db"))); const queued = jobs.create("resolve"); jobs.requestCancel(queued.id); expect(jobs.get(queued.id)).toMatchObject({ status: "cancelled", cancelRequested: true }); const running = jobs.create("resolve"); jobs.update(running.id, { status: "running" }); jobs.requestCancel(running.id); expect(jobs.get(running.id)).toMatchObject({ status: "running", cancelRequested: true, currentItem: "Cancellation requested" }); });
