"""Durable import workflow composed from acquisition and resolution capabilities."""

from .acquisition import PersistentAcquisitionService
from .resolution import PersistentResolutionService


class PersistentImportService(PersistentAcquisitionService, PersistentResolutionService):
    """Coordinate durable playlist acquisition and automatic resolution."""
