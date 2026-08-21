import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../../server/persistence/database";
import { ImportRepository } from "../../server/persistence/import-repository";
import { PlaylistRevisionRepository } from "../../server/persistence/playlist-revision-repository";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true })));
it("persists update audit snapshots including duplicate source occurrences", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-revision-"));
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
  const revisions = new PlaylistRevisionRepository(database);
  const recorded = revisions.record(imported.id, imports.entries(imported.id), [
    {
      position: 0,
      track: {
        source: "spotify",
        sourceTrackId: "same",
        title: "Song",
        artists: ["Artist"],
        album: "Album",
      },
    },
  ]);
  expect(revisions.list(imported.id)[0]).toMatchObject({
    id: recorded.id,
    removed: 1,
  });
  expect(revisions.get(imported.id, recorded.id)).toMatchObject({
    id: recorded.id,
    removed: 1,
    before: [
      { title: "Song", artists: ["Artist"], position: 0 },
      { title: "Song", artists: ["Artist"], position: 1 },
    ],
    after: [{ title: "Song", artists: ["Artist"], position: 0 }],
  });
  database.close();
});
