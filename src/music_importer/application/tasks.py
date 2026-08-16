"""A bounded in-process worker whose observable state is persisted in SQLite."""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from ..persistence.records import StoredJob
from ..persistence.repository import ImportRepository


class TaskManager:
    def __init__(self, repository: ImportRepository):
        self.repository = repository
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="music-importer")

    def submit(
        self,
        kind: str,
        operation: Callable[[str], None],
        import_id: str | None = None,
        *,
        total: int = 0,
    ) -> StoredJob:
        job = self.repository.create_job(kind, import_id, total=total)

        def run() -> None:
            if self.repository.get_job(job.id).cancel_requested:
                self.repository.update_job(job.id, status="cancelled")
                return
            self.repository.update_job(job.id, status="running")
            try:
                operation(job.id)
                current = self.repository.get_job(job.id)
                status = "cancelled" if current.cancel_requested else "completed"
                self.repository.update_job(job.id, status=status)
            except Exception as exc:
                current = self.repository.get_job(job.id)
                if current.cancel_requested:
                    self.repository.update_job(job.id, status="cancelled")
                else:
                    self.repository.update_job(job.id, status="failed", error=str(exc))

        self.executor.submit(run)
        return job
