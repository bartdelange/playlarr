import type Database from "better-sqlite3";
const now = () => new Date().toISOString();
export class SettingsRepository {
  constructor(private readonly database: Database.Database) {}
  set(key: string, value: unknown): void {
    this.database
      .prepare(
        "INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
      )
      .run(key, JSON.stringify(value), now());
  }
  get<T>(key: string, fallback: T): T {
    const row = this.database
      .prepare("SELECT value_json FROM settings WHERE key = ?")
      .get(key) as { value_json: string } | undefined;
    return row ? (JSON.parse(row.value_json) as T) : fallback;
  }
  all(): Record<string, unknown> {
    return Object.fromEntries(
      (
        this.database.prepare("SELECT key, value_json FROM settings").all() as {
          key: string;
          value_json: string;
        }[]
      ).map((row) => [row.key, JSON.parse(row.value_json)]),
    );
  }
}
