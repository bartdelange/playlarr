import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/server/persistence/database";
import { ImportRepository } from "../src/server/persistence/import-repository";

const paths: string[] = []; afterEach(() => paths.splice(0).forEach((value) => rmSync(value, { recursive: true })));
function repository() { const directory = mkdtempSync(path.join(tmpdir(), "playlarr-imports-")); paths.push(directory); return new ImportRepository(openDatabase(path.join(directory, "music-importer.db"))); }

describe("import repository", () => {
  it("persists ordered duplicate occurrences across a database reopen", () => {
    const imports = repository(); const imported = imports.createImport({ source: "spotify", id: "mix", name: "Mix" });
    imports.replaceTracks(imported.id, [{ source: "spotify", sourceTrackId: "same", title: "Song", artists: ["Artist"], album: "Album" }, { source: "spotify", sourceTrackId: "same", title: "Song", artists: ["Artist"], album: "Album" }]);
    expect(imports.entries(imported.id).map((entry) => [entry.position, entry.track.sourceTrackId])).toEqual([[0, "same"], [1, "same"]]);
    expect(imports.getImport(imported.id).workflowState).toBe("ready_to_resolve");
  });

  it("records source skips without discarding the source occurrence", () => {
    const imports = repository(); const imported = imports.createImport({ source: "tidal", id: "mix", name: "Mix" });
    imports.replaceAcquiredTracks(imported.id, [{ position: 4, track: { source: "tidal", sourceTrackId: "unavailable", title: "Gone", artists: [], album: "" }, skipReason: "unavailable" }]);
    expect(imports.entries(imported.id)[0]).toMatchObject({ position: 4, resolutionState: "skipped" });
  });
});
