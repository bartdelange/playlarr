"""Approved Lidarr plan and execution audit persistence."""

import json
import uuid
from dataclasses import asdict

from ..domain.models import LidarrPlan, LidarrPlanAction
from .timestamps import now


class LidarrPlansRepository:
    def save_lidarr_plan(self, import_id: str, plan: LidarrPlan) -> str:
        plan_id = str(uuid.uuid4())
        with self.connect() as db:
            db.execute(
                "UPDATE lidarr_plans SET status = 'superseded' WHERE import_id = ? AND status = 'draft'",
                (import_id,),
            )
            db.execute(
                "INSERT INTO lidarr_plans(id, import_id, status, created_at) VALUES (?, ?, 'draft', ?)",
                (plan_id, import_id, now()),
            )
            for position, action in enumerate(plan.actions):
                db.execute(
                    """INSERT INTO lidarr_plan_actions(plan_id, position, action_json)
                    VALUES (?, ?, ?)""",
                    (plan_id, position, json.dumps(asdict(action))),
                )
            db.execute(
                "UPDATE imports SET workflow_state = 'plan_ready', updated_at = ? WHERE id = ?",
                (now(), import_id),
            )
        return plan_id

    def get_lidarr_plan(self, plan_id: str) -> tuple[str, str, LidarrPlan]:
        with self.connect() as db:
            header = db.execute(
                "SELECT import_id, status FROM lidarr_plans WHERE id = ?", (plan_id,)
            ).fetchone()
            rows = db.execute(
                "SELECT action_json FROM lidarr_plan_actions WHERE plan_id = ? ORDER BY position",
                (plan_id,),
            ).fetchall()
        if header is None:
            raise KeyError(f"unknown Lidarr plan: {plan_id}")
        actions = tuple(LidarrPlanAction(**json.loads(row[0])) for row in rows)
        return header["import_id"], header["status"], LidarrPlan(actions)

    def latest_lidarr_plan(self, import_id: str) -> tuple[str, str, str, LidarrPlan] | None:
        with self.connect() as db:
            row = db.execute(
                """SELECT id FROM lidarr_plans WHERE import_id = ?
                ORDER BY created_at DESC LIMIT 1""",
                (import_id,),
            ).fetchone()
        return (row[0], *self.get_lidarr_plan(row[0])) if row else None

    def approve_lidarr_plan(self, plan_id: str) -> None:
        with self.connect() as db:
            cursor = db.execute(
                """UPDATE lidarr_plans SET status = 'approved', approved_at = ?
                WHERE id = ? AND status = 'draft'""",
                (now(), plan_id),
            )
            if cursor.rowcount != 1:
                raise ValueError("only a current draft plan can be approved")

    def record_lidarr_execution(self, plan_id: str, results) -> None:
        with self.connect() as db:
            for position, result in enumerate(results):
                db.execute(
                    """INSERT INTO lidarr_execution_results
                    (plan_id, action_position, attempted_at, outcome, details)
                    VALUES (?, ?, ?, ?, ?)""",
                    (plan_id, position, now(), result.outcome, result.details),
                )
            status = (
                "failed" if any(result.outcome == "failed" for result in results) else "completed"
            )
            db.execute("UPDATE lidarr_plans SET status = ? WHERE id = ?", (status, plan_id))
            db.execute(
                """UPDATE imports SET workflow_state = ?, updated_at = ?
                WHERE id = (SELECT import_id FROM lidarr_plans WHERE id = ?)""",
                (
                    "execution_failed" if status == "failed" else "waiting_for_downloads",
                    now(),
                    plan_id,
                ),
            )

    def lidarr_execution_results(self, plan_id: str) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                """SELECT action_position, attempted_at, outcome, details
                FROM lidarr_execution_results WHERE plan_id = ? ORDER BY id""",
                (plan_id,),
            ).fetchall()
        return [dict(row) for row in rows]
