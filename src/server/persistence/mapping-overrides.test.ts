import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "../../server/persistence/database";
import { ImportRepository } from "../../server/persistence/import-repository";
import { MappingOverridesRepository } from "../../server/persistence/mapping-overrides-repository";
import { ResolutionRepository } from "../../server/persistence/resolution-repository";

it("reuses only selected exact-ISRC mappings and marks them manual", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-overrides-"));
  try {
    const database = openDatabase(path.join(directory, "state.db"));
    const imports = new ImportRepository(database);
    const source = imports.createImport({
      source: "spotify",
      id: "source",
      name: "Source",
    });
    const target = imports.createImport({
      source: "tidal",
      id: "target",
      name: "Target",
    });
    imports.replaceTracks(source.id, [
      {
        source: "spotify",
        sourceTrackId: "one",
        title: "Source",
        artists: ["Artist"],
        album: "Album",
        isrc: "MATCH",
      },
    ]);
    imports.replaceTracks(target.id, [
      {
        source: "tidal",
        sourceTrackId: "two",
        title: "Target",
        artists: ["Artist"],
        album: "Album",
        isrc: "MATCH",
      },
    ]);
    const sourceEntry = imports.entries(source.id)[0];
    const targetEntry = imports.entries(target.id)[0];
    new ResolutionRepository(database).saveManual(
      sourceEntry.id,
      {
        resolvedVia: "manual_mbid",
        recordingTitle: "Mapped title",
        artistNames: ["Artist"],
        recordingIds: ["recording"],
        releaseGroupIds: ["group"],
        primaryArtistId: "artist",
      },
      "manual_mbid",
      "valid",
    );
    const overrides = new MappingOverridesRepository(database);
    expect(overrides.candidates(target.id, source.id)[0].status).toBe(
      "will_map",
    );
    expect(
      overrides.apply(target.id, source.id, new Set([targetEntry.id])),
    ).toBe(1);
    const saved = database
      .prepare(
        "SELECT is_manual, method, result_json, evidence_json FROM resolutions WHERE entry_id = ?",
      )
      .get(targetEntry.id) as {
      is_manual: number;
      method: string;
      result_json: string;
      evidence_json: string;
    };
    expect(saved.is_manual).toBe(1);
    expect(saved.method).toBe("reused_manual");
    expect(JSON.parse(saved.result_json).recordingIds).toEqual(["recording"]);
    expect(JSON.parse(saved.evidence_json).matched_by).toBe("isrc");
    database.close();
  } finally {
    rmSync(directory, { recursive: true });
  }
});

it("normalizes legacy schema-v8 mappings before comparison and persistence", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-overrides-"));
  try {
    const database = openDatabase(path.join(directory, "state.db"));
    const imports = new ImportRepository(database);
    const source = imports.createImport({
      source: "spotify",
      id: "source",
      name: "Source",
    });
    const target = imports.createImport({
      source: "tidal",
      id: "target",
      name: "Target",
    });
    for (const imported of [source, target])
      imports.replaceTracks(imported.id, [
        {
          source: imported.source,
          sourceTrackId: imported.id,
          title: imported.playlistName,
          artists: ["Artist"],
          album: "Album",
          isrc: "EXACT",
        },
      ]);
    const [sourceEntry] = imports.entries(source.id);
    const [targetEntry] = imports.entries(target.id);
    database
      .prepare(
        "UPDATE resolutions SET state = 'manually_resolved', method = 'manual_mbid', result_json = ?, is_manual = 1 WHERE entry_id = ?",
      )
      .run(
        JSON.stringify({
          resolved_via: "manual_mbid",
          recording_title: "Legacy title",
          artist_names: ["Legacy artist"],
          recording_ids: ["recording"],
          release_group_ids: ["group"],
          primary_artist_id: "artist",
        }),
        sourceEntry.id,
      );
    const overrides = new MappingOverridesRepository(database);

    const [candidate] = overrides.candidates(target.id, source.id);
    expect(candidate).toMatchObject({
      status: "will_map",
      sourceResult: {
        recordingTitle: "Legacy title",
        recordingIds: ["recording"],
      },
      targetResult: { recordingIds: [] },
    });
    overrides.apply(target.id, source.id, new Set([targetEntry.id]));
    const persisted = JSON.parse(
      String(
        database
          .prepare("SELECT result_json FROM resolutions WHERE entry_id = ?")
          .pluck()
          .get(targetEntry.id),
      ),
    );
    expect(persisted).toMatchObject({
      resolvedVia: "manual_mbid",
      recordingTitle: "Legacy title",
      recordingIds: ["recording"],
    });
    expect(persisted).not.toHaveProperty("recording_ids");
    database.close();
  } finally {
    rmSync(directory, { recursive: true });
  }
});
