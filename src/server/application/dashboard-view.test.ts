import { expect, it } from "vitest";
import { openDatabase } from "../../server/persistence/database";
import { ImportRepository } from "../../server/persistence/import-repository";
import { dashboardImportRows } from "../../server/application/dashboard-view";
import { JobRepository } from "../../server/persistence/job-repository";

it("derives dashboard resolution, review, action, and active-job context", () => {
  const database = openDatabase(":memory:");
  const imports = new ImportRepository(database);
  const importId = "00000000-0000-4000-8000-000000000001";
  const imported = imports.createImport({ source: "spotify", id: "list", name: "List" }, {}, importId);
  imports.replaceTracks(importId, [
    {
      source: "spotify",
      sourceTrackId: "one",
      title: "One",
      artists: ["Artist"],
      album: "Album",
    },
    {
      source: "spotify",
      sourceTrackId: "two",
      title: "Two",
      artists: ["Artist"],
      album: "Album",
    },
  ]);
  database
    .prepare("UPDATE resolutions SET state = 'manually_resolved', result_json = ? WHERE entry_id = 1")
    .run(JSON.stringify({ resolved_via: "manual_mbid", recording_ids: ["mbid"] }));
  database.prepare("UPDATE resolutions SET state = 'ambiguous' WHERE entry_id = 2").run();
  database.prepare("UPDATE imports SET workflow_state = 'review_required' WHERE id = ?").run(importId);
  const active = new JobRepository(database).create("resolution", importId, 2);

  expect(dashboardImportRows(database, [{ ...imported, workflowState: "review_required" }], [active])[0]).toMatchObject(
    {
      tracks: 2,
      resolved: 1,
      review: 1,
      nextAction: "Review 1 tracks",
      job: { id: active.id },
    },
  );
});
