import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, SCHEMA_VERSION } from "../src/server/persistence/database";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true })));
const databasePath = () => { const directory = mkdtempSync(path.join(tmpdir(), "playlarr-")); directories.push(directory); return path.join(directory, "music-importer.db"); };

describe("SQLite schema", () => {
  it("creates the compatible schema-v8 database", () => {
    const database = openDatabase(databasePath());
    expect(database.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'local_playlist_additions'").get()).toBeDefined();
    database.close();
  });

  it("marks unfinished jobs interrupted when opening an existing schema-v8 database", () => {
    const target = databasePath(); const database = openDatabase(target);
    database.prepare("INSERT INTO jobs (id, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("job-1", "import", "running", "before", "before"); database.close();
    const reopened = openDatabase(target);
    expect(reopened.prepare("SELECT status FROM jobs WHERE id = 'job-1'").pluck().get()).toBe("interrupted"); reopened.close();
  });
});
