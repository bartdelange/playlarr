import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../server/persistence/database";
import { ImportRepository } from "../../server/persistence/import-repository";
import { ResolutionRepository } from "../../server/persistence/resolution-repository";

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
  it("reads Music Match statuses from persisted resolution state", () => {
    const imports = repository();
    const imported = imports.createImport({
      source: "spotify",
      id: "status-mix",
      name: "Status Mix",
    });
    imports.replaceTracks(
      imported.id,
      ["pending", "unresolved", "automatic", "manual", "skipped"].map((id) => ({
        source: "spotify",
        sourceTrackId: id,
        title: id,
        artists: ["Artist"],
        album: "Album",
      })),
    );
    const entries = imports.entries(imported.id);
    const database = (
      imports as unknown as { database: import("better-sqlite3").Database }
    ).database;
    const resolutions = new ResolutionRepository(database);

    resolutions.saveAutomatic(entries[1].id, {});
    resolutions.saveAutomatic(entries[2].id, {
      resolvedVia: "isrc",
      recordingIds: ["automatic-recording"],
    });
    resolutions.saveManual(
      entries[3].id,
      {
        resolvedVia: "manual_mbid",
        recordingIds: ["manual-recording"],
      },
      "manual_mbid",
      "valid",
    );
    database
      .prepare(
        `UPDATE resolutions
         SET state = 'skipped', method = 'manual_skip', is_manual = 1,
           result_json = '{}', evidence_json = '{"manual_action":"skip"}'
         WHERE entry_id = ?`,
      )
      .run(entries[4].id);

    expect(
      imports.entries(imported.id).map((entry) => entry.resolutionState),
    ).toEqual([
      "pending",
      "unresolved",
      "automatically_resolved",
      "manually_resolved",
      "skipped",
    ]);
  });
  it("projects matched recordings from representative schema-v8 resolutions", () => {
    const imports = repository();
    const imported = imports.createImport({
      source: "spotify",
      id: "matched-recordings",
      name: "Matched Recordings",
    });
    imports.replaceTracks(
      imported.id,
      ["pending", "manual-search", "manual-mbid", "isrc", "skipped"].map(
        (id) => ({
          source: "spotify",
          sourceTrackId: id,
          title: `Source ${id}`,
          artists: ["Source Artist"],
          album: "Source Album",
        }),
      ),
    );
    const entries = imports.entries(imported.id);
    const database = (
      imports as unknown as { database: import("better-sqlite3").Database }
    ).database;
    const update = database.prepare(
      `UPDATE resolutions
       SET state = ?, method = ?, result_json = ?, is_manual = ?
       WHERE entry_id = ?`,
    );

    update.run(
      "manually_resolved",
      "manual_search",
      JSON.stringify({
        resolved_via: "manual_search",
        recording_title: "Manual Search Recording",
        artist_names: ["Search Artist", "Guest Artist"],
        recording_ids: ["search-recording-mbid"],
      }),
      1,
      entries[1].id,
    );
    update.run(
      "manually_resolved",
      "manual_mbid",
      JSON.stringify({
        resolved_via: "manual_mbid",
        recording_title: "Manual MBID Recording",
        artist_names: ["MBID Artist"],
        recording_ids: ["manual-recording-mbid"],
      }),
      1,
      entries[2].id,
    );
    update.run(
      "automatically_resolved",
      "isrc",
      JSON.stringify({
        resolved_via: "isrc",
        recording_title: "Automatic Recording",
        artist_names: ["Automatic Artist"],
        recording_ids: ["automatic-recording-mbid"],
      }),
      0,
      entries[3].id,
    );
    update.run("skipped", "manual_skip", "{}", 1, entries[4].id);

    expect(
      entries.map((entry) =>
        imports.musicMatchRecordings(imported.id).get(entry.id),
      ),
    ).toEqual([
      { title: undefined, artists: [], recordingIds: [] },
      {
        title: "Manual Search Recording",
        artists: ["Search Artist", "Guest Artist"],
        recordingIds: ["search-recording-mbid"],
      },
      {
        title: "Manual MBID Recording",
        artists: ["MBID Artist"],
        recordingIds: ["manual-recording-mbid"],
      },
      {
        title: "Automatic Recording",
        artists: ["Automatic Artist"],
        recordingIds: ["automatic-recording-mbid"],
      },
      { title: undefined, artists: [], recordingIds: [] },
    ]);
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
