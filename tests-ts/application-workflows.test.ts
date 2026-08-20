import { expect, it } from "vitest";
import { PersistentAcquisitionService } from "../src/server/application/acquisition";
import { resolveImport } from "../src/server/application/resolution";
it("acquires source tracks into ordered durable entries", async () => {
  const calls: string[] = [];
  const repository = {
    createImport: () => ({ id: "import" }),
    updatePlaylist: () => calls.push("update"),
    replaceAcquiredTracks: (_id: string, entries: unknown[]) =>
      calls.push(`entries:${entries.length}`),
    setWorkflowState: () => {},
    getImport: () => ({ id: "import", workflowState: "ready_to_resolve" }),
  };
  const service = new PersistentAcquisitionService(repository as never);
  const imported = await service.acquire(
    {
      getTracks: async () => [
        {
          source: "spotify",
          sourceTrackId: "song",
          title: "Song",
          artists: [],
          album: "",
        },
      ],
    },
    { source: "spotify", id: "mix", name: "Mix" },
  );
  expect(imported.id).toBe("import");
  expect(calls).toEqual(["update", "entries:1"]);
});
it("moves unresolved automated work to review while retaining manual and skipped entries", async () => {
  const states: string[] = [];
  const entries = [
    {
      id: 1,
      importId: "import",
      position: 0,
      resolutionState: "pending",
      isManual: false,
      track: {
        source: "spotify",
        sourceTrackId: "one",
        title: "One",
        artists: [],
        album: "",
      },
    },
    {
      id: 2,
      importId: "import",
      position: 1,
      resolutionState: "skipped",
      isManual: false,
      track: {
        source: "spotify",
        sourceTrackId: "two",
        title: "Two",
        artists: [],
        album: "",
      },
    },
  ];
  const repository = {
    entries: () => entries,
    setWorkflowState: (_id: string, state: string) => states.push(state),
    markResolving: () => true,
    saveAutomatic: () => true,
  };
  const summary = await resolveImport(repository, "import", {
    resolve: async () => ({}),
  });
  expect(summary.unresolved).toBe(1);
  expect(states).toEqual(["resolving", "review_required"]);
});
