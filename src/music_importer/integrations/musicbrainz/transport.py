import logging
import time

import requests

logger = logging.getLogger("music_importer.integrations.musicbrainz.client")


class TransportClient:
    def __init__(
        self, base_url: str, user_agent: str, delay: float, timeout: float, max_retries: int
    ):
        if not user_agent:
            raise ValueError("MUSICBRAINZ_USER_AGENT is required (include a contact email or URL)")
        self.base_url = base_url
        self.delay = max(delay, 0)
        self.timeout = timeout
        self.max_retries = max(1, max_retries)
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": user_agent, "Accept": "application/json"})
        self._last_request = 0.0

    def _get(self, path: str, params: dict) -> dict | None:
        for attempt in range(1, self.max_retries + 1):
            elapsed = time.monotonic() - self._last_request
            if elapsed < self.delay:
                time.sleep(self.delay - elapsed)
            try:
                response = self.session.get(
                    f"{self.base_url}/{path.lstrip('/')}", params=params, timeout=self.timeout
                )
                self._last_request = time.monotonic()
                if response.status_code == 404:
                    return None
                if response.status_code == 429 or 500 <= response.status_code < 600:
                    raise requests.HTTPError(
                        f"temporary MusicBrainz HTTP {response.status_code}", response=response
                    )
                response.raise_for_status()
                return response.json()
            except (
                requests.ConnectionError,
                requests.Timeout,
                requests.HTTPError,
                ValueError,
            ) as exc:
                temporary = not isinstance(exc, requests.HTTPError) or (
                    exc.response is not None
                    and (exc.response.status_code == 429 or exc.response.status_code >= 500)
                )
                if not temporary or attempt == self.max_retries:
                    logger.warning("MusicBrainz request failed: %s", exc)
                    return None
                wait = min(1.5 * attempt, 10)
                logger.warning(
                    "MusicBrainz request failed (attempt %d/%d); retrying in %.1fs",
                    attempt,
                    self.max_retries,
                    wait,
                )
                time.sleep(wait)
        return None
