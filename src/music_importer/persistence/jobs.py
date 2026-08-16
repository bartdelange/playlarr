"""Durable background-job state and result persistence."""

import json
import uuid

from .records import StoredJob
from .timestamps import now


class JobsRepository:
    def create_job(self, kind: str, import_id: str | None = None, *, total: int = 0) -> StoredJob:
        identifier = str(uuid.uuid4())
        timestamp = now()
        with self.connect() as db:
            db.execute(
                """INSERT INTO jobs
                (id, import_id, kind, status, total, created_at, updated_at)
                VALUES (?, ?, ?, 'queued', ?, ?, ?)""",
                (identifier, import_id, kind, total, timestamp, timestamp),
            )
        return self.get_job(identifier)

    def get_job(self, job_id: str) -> StoredJob:
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise KeyError(f"unknown job: {job_id}")
        return StoredJob(
            row["id"],
            row["import_id"],
            row["kind"],
            row["status"],
            row["current"],
            row["total"],
            row["current_item"],
            bool(row["cancel_requested"]),
            row["error"],
        )

    def list_jobs(self, *, limit: int = 50) -> list[StoredJob]:
        with self.connect() as db:
            rows = db.execute(
                """SELECT id FROM jobs
                ORDER BY CASE status
                    WHEN 'running' THEN 0
                    WHEN 'queued' THEN 1
                    ELSE 2
                END,
                CASE WHEN status = 'queued' THEN created_at END ASC,
                updated_at DESC LIMIT ?""",
                (limit,),
            ).fetchall()
        return [self.get_job(row["id"]) for row in rows]

    def update_job(
        self,
        job_id: str,
        *,
        status: str | None = None,
        current: int | None = None,
        total: int | None = None,
        current_item: str | None = None,
        error: str | None = None,
    ) -> None:
        fields: dict[str, object] = {"updated_at": now()}
        if status is not None:
            fields["status"] = status
        if current is not None:
            fields["current"] = current
        if total is not None:
            fields["total"] = total
        if current_item is not None:
            fields["current_item"] = current_item
        if error is not None:
            fields["error"] = error
        assignments = ", ".join(f"{key} = ?" for key in fields)
        with self.connect() as db:
            db.execute(f"UPDATE jobs SET {assignments} WHERE id = ?", (*fields.values(), job_id))

    def save_job_result(self, job_id: str, result: dict) -> None:
        with self.connect() as db:
            db.execute(
                "UPDATE jobs SET result_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(result), now(), job_id),
            )

    def job_result(self, job_id: str) -> dict | None:
        with self.connect() as db:
            row = db.execute("SELECT result_json FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise KeyError(f"unknown job: {job_id}")
        return json.loads(row[0]) if row[0] else None

    def request_job_cancel(self, job_id: str) -> None:
        with self.connect() as db:
            db.execute(
                """UPDATE jobs SET cancel_requested = 1,
                status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
                current_item = CASE WHEN status = 'running' THEN 'Cancellation requested' ELSE current_item END,
                updated_at = ? WHERE id = ?""",
                (now(), job_id),
            )
