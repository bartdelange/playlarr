import tempfile
import threading
import unittest
from pathlib import Path

from music_importer.persistence import ImportRepository
from music_importer.tasks import TaskManager


class TaskManagerTests(unittest.TestCase):
    def test_persists_progress_and_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            manager = TaskManager(repository)
            completed = threading.Event()

            def operation(job_id):
                repository.update_job(job_id, current=2, total=3, current_item="Song")
                completed.set()

            job = manager.submit("resolution", operation, total=3)
            self.assertTrue(completed.wait(2))
            manager.executor.shutdown(wait=True)
            stored = repository.get_job(job.id)

        self.assertEqual(stored.status, "completed")
        self.assertEqual((stored.current, stored.total, stored.current_item), (2, 3, "Song"))

    def test_running_job_is_marked_interrupted_after_repository_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.db"
            repository = ImportRepository(path)
            job = repository.create_job("resolution")
            repository.update_job(job.id, status="running")

            restarted = ImportRepository(path)
            status = restarted.get_job(job.id).status

        self.assertEqual(status, "interrupted")

    def test_cancelling_queued_job_prevents_operation(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            manager = TaskManager(repository)
            release_first = threading.Event()
            second_ran = threading.Event()
            manager.submit("first", lambda _: release_first.wait(2))
            second = manager.submit("second", lambda _: second_ran.set())

            repository.request_job_cancel(second.id)
            release_first.set()
            manager.executor.shutdown(wait=True)
            second_status = repository.get_job(second.id).status

        self.assertEqual(second_status, "cancelled")
        self.assertFalse(second_ran.is_set())


if __name__ == "__main__":
    unittest.main()
