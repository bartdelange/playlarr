import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../src/server/persistence/database";
import { ImportRepository } from "../src/server/persistence/import-repository";
import { LocalAdditionsRepository } from "../src/server/persistence/local-additions-repository";
const paths: string[] = [];
afterEach(() =>
  paths.splice(0).forEach((value) => rmSync(value, { recursive: true })),
);
it("persists ordered local additions and guards import-scoped deletion", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-additions-"));
  paths.push(directory);
  const database = openDatabase(path.join(directory, "state.db"));
  const imports = new ImportRepository(database);
  const imported = imports.createImport({
    source: "spotify",
    id: "list",
    name: "List",
  });
  const additions = new LocalAdditionsRepository(database);
  const first = additions.add(imported.id, {
    provider: "navidrome",
    providerTrackId: "one",
    title: "One",
    artists: ["Artist"],
    album: "Album",
  });
  additions.add(imported.id, {
    provider: "navidrome",
    providerTrackId: "two",
    title: "Two",
    artists: [],
    album: "",
  });
  expect(additions.list(imported.id).map((item) => item.ordinal)).toEqual([
    0, 1,
  ]);
  expect(() => additions.remove("other", first)).toThrow("does not exist");
  additions.remove(imported.id, first);
  expect(
    additions.list(imported.id).map((item) => item.providerTrackId),
  ).toEqual(["two"]);
});
