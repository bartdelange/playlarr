import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { addAuthoritativeLocalTrack } from "../../server/application/local-additions";
import { openDatabase } from "../../server/persistence/database";
import { ImportRepository } from "../../server/persistence/import-repository";
import { LocalAdditionsRepository } from "../../server/persistence/local-additions-repository";

it("reloads authoritative Navidrome metadata from only the submitted song identity", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-local-addition-"));
  try {
    const database = openDatabase(path.join(directory, "state.db"));
    const imported = new ImportRepository(database).createImport({
      source: "spotify",
      id: "playlist",
      name: "Playlist",
    });
    const source = {
      song: vi.fn(async (id: string) => ({
        id,
        title: "Authoritative title",
        artist: "Authoritative artist",
        album: "Authoritative album",
        path: "/music/authoritative.flac",
      })),
    };
    const repository = new LocalAdditionsRepository(database);

    await addAuthoritativeLocalTrack(repository, source, imported.id, "song-7");

    expect(source.song).toHaveBeenCalledWith("song-7");
    expect(repository.list(imported.id)).toEqual([
      expect.objectContaining({
        provider: "navidrome",
        providerTrackId: "song-7",
        title: "Authoritative title",
        artists: ["Authoritative artist"],
        album: "Authoritative album",
        pathSnapshot: "/music/authoritative.flac",
      }),
    ]);
    database.close();
  } finally {
    rmSync(directory, { recursive: true });
  }
});
