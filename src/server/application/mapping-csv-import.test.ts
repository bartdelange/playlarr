import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { importMappingCsv } from "../../server/application/mapping-csv-import";
import { serializeCsv } from "../../server/exports/mapping-report";
import { openDatabase } from "../../server/persistence/database";
import { ImportRepository } from "../../server/persistence/import-repository";
import { ResolutionRepository } from "../../server/persistence/resolution-repository";

it("imports a master mapping CSV with ordered tracks and imported resolution semantics", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-csv-import-"));
  try {
    const database = openDatabase(path.join(directory, "state.db"));
    const imports = new ImportRepository(database);
    const resolutions = new ResolutionRepository(database);
    const csv = serializeCsv([
      {
        source: "spotify",
        source_playlist_id: "mix",
        source_track_id: "track-1",
        track_title: "Song, quoted",
        artists: "Artist; Guest",
        album: "Album",
        isrc: "ISRC",
        resolved_via: "isrc",
        mb_recording_title: "Recording",
        mb_artist_names: "Artist",
        mb_recording_ids: "recording",
        mb_release_ids: "release",
        mb_release_group_ids: "group",
        mb_artist_ids: "artist",
        mb_primary_artist_id: "artist",
        failure_reason: "",
        duration_ms: "123",
      },
    ]);

    const imported = importMappingCsv(
      csv,
      "Imported Mix",
      imports,
      resolutions,
    );

    expect(imported).toMatchObject({
      sourcePlaylistId: "mix",
      playlistName: "Imported Mix",
      workflowState: "ready_to_plan",
    });
    expect(imports.entries(imported.id)[0].track).toMatchObject({
      title: "Song, quoted",
      artists: ["Artist", "Guest"],
      durationMs: 123,
    });
    expect(resolutions.get(imports.entries(imported.id)[0].id)).toMatchObject({
      state: "automatically_resolved",
      method: "imported_from_csv",
      result: { recordingIds: ["recording"], releaseGroupIds: ["group"] },
      evidence: { source: "mapping_csv" },
    });
    database.close();
  } finally {
    rmSync(directory, { recursive: true });
  }
});
