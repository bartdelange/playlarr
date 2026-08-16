"""Runtime dependencies shared by web presentation modules."""

from dataclasses import dataclass

from ..application.tasks import TaskManager
from ..config import Config
from ..integrations.sources.registry import create_source
from ..persistence import ImportRepository


@dataclass(slots=True)
class WebContext:
    config: Config
    repository: ImportRepository
    tasks: TaskManager
    sources: dict[str, object]

    def source(self, name: str):
        if name not in self.sources:
            self.sources[name] = create_source(name, self.config)
        return self.sources[name]
