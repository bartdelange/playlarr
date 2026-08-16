"""Manual-review client construction and session navigation."""

from fastapi.responses import RedirectResponse

from ..integrations.musicbrainz import MusicBrainzClient
from .context import WebContext

REVIEW_STATES = {"unresolved", "ambiguous", "validation_failed"}


class ReviewSupport:
    def __init__(self, context: WebContext):
        self.context = context

    def mb_client(self) -> MusicBrainzClient:
        config = self.context.config
        return MusicBrainzClient(
            config.mb_base_url,
            config.mb_user_agent,
            config.mb_request_delay,
            config.mb_timeout,
            config.mb_max_retries,
        )

    def queue(self, import_id: str):
        return [
            entry
            for entry in self.context.repository.entries(import_id)
            if entry.resolution_state in REVIEW_STATES
        ]

    def session_values(self, entry, active: bool) -> dict:
        queue = self.queue(entry.import_id)
        index = next((position for position, item in enumerate(queue) if item.id == entry.id), 0)
        return {
            "session": active,
            "session_index": index + 1,
            "session_total": len(queue),
            "previous_entry": queue[index - 1] if active and index > 0 else None,
            "next_entry": queue[index + 1] if active and index + 1 < len(queue) else None,
        }

    def redirect(self, entry, active: bool) -> RedirectResponse:
        if not active:
            return RedirectResponse(f"/imports/{entry.import_id}", status_code=303)
        queue = self.queue(entry.import_id)
        following = next((item for item in queue if item.position > entry.position), None)
        target = following or (queue[0] if queue else None)
        location = (
            f"/entries/{target.id}/review?session=true" if target else f"/imports/{entry.import_id}"
        )
        return RedirectResponse(location, status_code=303)
