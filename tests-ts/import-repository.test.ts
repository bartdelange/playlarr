import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/server/persistence/database";
import { ImportRepository } from "../src/server/persistence/import-repository";

const paths: string[] = [];
afterEach(() =>
  paths.splice(0).forEach((value) => rmSync(value, { recursive: true })),
);
function repository() {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-imports-"));
  paths.push(directory);
  return new ImportRepository(
    openDatabase(path.join(directory, "music-importer.db")),
  );
}

describe("import repository", () => {
  it("persists ordered duplicate occurrences across a database reopen", () => {
    const imports = repository();
    const imported = imports.createImport({
      source: "spotify",
      id: "mix",
      name: "Mix",
    });
    imports.replaceTracks(imported.id, [
      {
        source: "spotify",
        sourceTrackId: "same",
        title: "Song",
        artists: ["Artist"],
        album: "Album",
      },
      {
        source: "spotify",
        sourceTrackId: "same",
        title: "Song",
        artists: ["Artist"],
        album: "Album",
      },
    ]);
    expect(
      imports
        .entries(imported.id)
        .map((entry) => [entry.position, entry.track.sourceTrackId]),
    ).toEqual([
      [0, "same"],
      [1, "same"],
    ]);
    expect(imports.getImport(imported.id).workflowState).toBe(
      "ready_to_resolve",
    );
  });

  it("records source skips without discarding the source occurrence", () => {
    const imports = repository();
    const imported = imports.createImport({
      source: "tidal",
      id: "mix",
      name: "Mix",
    });
    imports.replaceAcquiredTracks(imported.id, [
      {
        position: 4,
        track: {
          source: "tidal",
          sourceTrackId: "unavailable",
          title: "Gone",
          artists: [],
          album: "",
        },
        skipReason: "unavailable",
      },
    ]);
    expect(imports.entries(imported.id)[0]).toMatchObject({
      position: 4,
      resolutionState: "skipped",
    });
  });
  it("applies an update transactionally, retains a matched occurrence, and supersedes approved plans", () => {
    const imports = repository();
    const imported = imports.createImport({
      source: "spotify",
      id: "mix",
      name: "Old",
    });
    imports.replaceTracks(imported.id, [
      {
        source: "spotify",
        sourceTrackId: "keep",
        title: "Keep",
        artists: ["Artist"],
        album: "Album",
      },
      {
        source: "spotify",
        sourceTrackId: "remove",
        title: "Remove",
        artists: ["Artist"],
        album: "Album",
      },
    ]);
    const kept = imports.entries(imported.id)[0];
    const database = (
      imports as unknown as { database: import("better-sqlite3").Database }
    ).database;
    database
      .prepare(
        "INSERT INTO lidarr_plans (id, import_id, status, created_at) VALUES ('approved', ?, 'approved', ?)",
      )
      .run(imported.id, new Date().toISOString());
    const update = imports.applyPlaylistUpdate(
      imported.id,
      { source: "spotify", id: "mix", name: "New" },
      [
        {
          position: 0,
          track: {
            source: "spotify",
            sourceTrackId: "new",
            title: "New",
            artists: [],
            album: "",
          },
        },
        {
          position: 1,
          track: {
            source: "spotify",
            sourceTrackId: "keep",
            title: "Keep",
            artists: ["Artist"],
            album: "Album",
          },
        },
      ],
    );
    expect(update).toMatchObject({ added: 1, removed: 1 });
    expect(imports.entries(imported.id)[1].id).toBe(kept.id);
    expect(
      database
        .prepare("SELECT status FROM lidarr_plans WHERE id = 'approved'")
        .pluck()
        .get(),
    ).toBe("superseded");
  });
});
