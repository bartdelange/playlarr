"""Persisted application settings."""

import json

from .timestamps import now


class SettingsRepository:
    def set_setting(self, key: str, value: object) -> None:
        with self.connect() as db:
            db.execute(
                """INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                updated_at = excluded.updated_at""",
                (key, json.dumps(value), now()),
            )

    def get_setting(self, key: str, default: object = None) -> object:
        with self.connect() as db:
            row = db.execute("SELECT value_json FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else default
