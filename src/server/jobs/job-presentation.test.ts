import { expect, it } from "vitest";
import { jobCompletionUrl, queuePositions } from "../../server/application/job-presentation";
import type { StoredJob } from "../../server/persistence/job-repository";

const job = (values: Partial<StoredJob>): StoredJob => ({
  id: "job",
  kind: "resolution",
  status: "queued",
  current: 0,
  total: 1,
  cancelRequested: false,
  ...values,
});

it("uses master queue ordering and completion destinations", () => {
  expect(queuePositions([job({ id: "a" }), job({ id: "running", status: "running" }), job({ id: "b" })])).toEqual(
    new Map([
      ["a", 1],
      ["b", 2],
    ]),
  );
  expect(jobCompletionUrl(job({ kind: "lidarr_planning", importId: "import" }))).toBe("/imports/import?stage=lidarr");
  expect(jobCompletionUrl(job({ kind: "playlist_update_preview", importId: "import" }))).toBe(
    "/imports/import/update?preview_job=job",
  );
  expect(jobCompletionUrl(job({ kind: "playlist_catalogue", payload: { source: "spotify" } }))).toBe(
    "/imports/new?source=spotify&catalog_job=job",
  );
});
