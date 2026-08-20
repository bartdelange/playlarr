import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../../server/persistence/database";
import { ImportRepository } from "../../server/persistence/import-repository";
import { LibraryRepository } from "../../server/persistence/library-repository";
import { SettingsRepository } from "../../server/persistence/settings-repository";
const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true })),
);
it("persists settings, library state, and exports without losing import state", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-library-"));
  directories.push(directory);
  const database = openDatabase(path.join(directory, "music-importer.db"));
  const imports = new ImportRepository(database);
  const imported = imports.createImport({
    source: "spotify",
    id: "mix",
    name: "Mix",
  });
  imports.replaceTracks(imported.id, [
    {
      source: "spotify",
      sourceTrackId: "song",
      title: "Song",
      artists: ["Artist"],
      album: "Album",
    },
  ]);
  const settings = new SettingsRepository(database);
  settings.set("services", { lidarrUrl: "http://lidarr" });
  expect(settings.get("services", {})).toEqual({ lidarrUrl: "http://lidarr" });
  const library = new LibraryRepository(database);
  library.savePlaylistAnalysis("spotify", "mix", "Mix", "complete", {
    tracks: 4,
    resolved: 3,
    artists_to_add: 1,
  });
  expect(library.playlistAnalyses("spotify").mix).toMatchObject({
    status: "complete",
    tracks: 4,
    resolved: 3,
    artists_to_add: 1,
    updatedAt: expect.any(String),
  });
  expect(library.latestExport(imported.id)).toBeUndefined();
  library.saveStatus(imported.id, [
    { position: 0, classification: "downloaded", path: "/music/song.flac" },
  ]);
  const exportId = library.recordExport(
    imported.id,
    "/playlists/mix.m3u8",
    1,
    0,
  );
  expect(exportId).toBeTruthy();
  database
    .prepare("UPDATE playlist_exports SET created_at = ? WHERE id = ?")
    .run("2020-01-01T00:00:00.000Z", exportId);
  const latestId = library.recordExport(
    imported.id,
    "/playlists/mix-latest.m3u8",
    3,
    2,
  );
  expect(library.latestExport(imported.id)).toEqual({
    id: latestId,
    importId: imported.id,
    outputPath: "/playlists/mix-latest.m3u8",
    writtenTracks: 3,
    missingTracks: 2,
    createdAt: expect.any(String),
  });
  expect(imports.getImport(imported.id).workflowState).toBe(
    "playlist_generated",
  );
  database.close();
});
