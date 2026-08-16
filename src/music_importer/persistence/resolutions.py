"""Composed persistence for track resolution state."""

from .automatic_resolutions import AutomaticResolutionsRepository
from .manual_resolutions import ManualResolutionsRepository
from .mapping_overrides import MappingOverridesRepository
from .resolution_candidates import ResolutionCandidatesRepository
from .resolution_entries import ResolutionEntriesRepository


class ResolutionsRepository(
    AutomaticResolutionsRepository,
    ManualResolutionsRepository,
    MappingOverridesRepository,
    ResolutionEntriesRepository,
    ResolutionCandidatesRepository,
):
    pass
