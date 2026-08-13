import logging
import re
import time
from difflib import SequenceMatcher

import requests

from .models import (
    ManualValidation,
    MusicBrainzCandidate,
    MusicBrainzResult,
    SourceTrack,
)

logger = logging.getLogger(__name__)
_ISRC = re.compile(r"^[A-Z]{2}[A-Z0-9]{3}\d{7}$")
_MBID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.IGNORECASE
)
_VERSION_WORDS = {"remix", "edit", "extended", "radio", "club", "vip", "mix"}
_STOPWORDS = _VERSION_WORDS | {
    "feat",
    "ft",
    "version",
    "album",
    "single",
    "original",
    "the",
    "a",
    "an",
    "of",
    "for",
    "and",
}


def _unique(values):
    return tuple(dict.fromkeys(value for value in values if value))


def _words(value: str) -> set[str]:
    return {word for word in re.findall(r"[a-z0-9]+", value.casefold()) if word not in _STOPWORDS}


def _name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def _marked(title: str) -> bool:
    return bool(set(re.findall(r"[a-z]+", title.casefold())) & _VERSION_WORDS)


def _search_title(title: str) -> str:
    title = re.sub(r"\s*[([](?:feat|ft)\.?[^)\]]*[)\]]", "", title, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", title).strip()


def _release_score(release: dict, source_album: str) -> float:
    group = release.get("release-group") or {}
    source = _name(source_album)
    titles = [_name(release.get("title") or ""), _name(group.get("title") or "")]
    score = (
        max(
            (SequenceMatcher(None, source, title).ratio() for title in titles if title), default=0.0
        )
        * 100
    )
    if source and source in titles:
        score += 1000
    secondary_types = {value.casefold() for value in group.get("secondary-types") or []}
    if "compilation" in secondary_types and source not in titles:
        score -= 30
    if (release.get("status") or "").casefold() == "official":
        score += 5
    return score


class MusicBrainzClient:
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

    @staticmethod
    def _result(recordings: list[dict], via: str, source_album: str) -> MusicBrainzResult | None:
        recording_ids, release_ids, group_ids, artist_ids = [], [], [], []
        primary = None
        releases = []
        for recording in recordings:
            recording_ids.append(recording.get("id"))
            credits = recording.get("artist-credit") or []
            if credits and primary is None:
                primary = (credits[0].get("artist") or {}).get("id")
            artist_ids.extend((entry.get("artist") or {}).get("id") for entry in credits)
            for release in recording.get("releases") or []:
                if (release.get("release-group") or {}).get("id"):
                    releases.append(release)
        if releases:
            selected = max(releases, key=lambda release: _release_score(release, source_album))
            selected_group = (selected.get("release-group") or {}).get("id")
            group_ids.append(selected_group)
            release_ids.extend(
                release.get("id")
                for release in releases
                if (release.get("release-group") or {}).get("id") == selected_group
            )
        ids = _unique(recording_ids)
        if not ids:
            return None
        first = recordings[0]
        names = _unique(
            (entry.get("artist") or {}).get("name") for entry in first.get("artist-credit") or []
        )
        return MusicBrainzResult(
            via,
            first.get("title") or "",
            names,
            ids,
            _unique(release_ids),
            _unique(group_ids),
            _unique(artist_ids),
            primary,
        )

    def _by_isrc(self, isrc: str, track: SourceTrack) -> MusicBrainzResult | None:
        # The dedicated /isrc/{isrc} endpoint rejects the release-groups
        # include. An exact recording search returns the same ISRC matches and
        # supports the release metadata needed for Lidarr in a single request.
        data = self._get(
            "recording",
            {
                "query": f"isrc:{isrc}",
                "inc": "artist-credits+releases+release-groups",
                "limit": 100,
                "fmt": "json",
            },
        )
        return self._result((data or {}).get("recordings") or [], "isrc", track.album)

    def _by_search(self, track: SourceTrack) -> MusicBrainzResult | None:
        title = _search_title(track.title)
        query = f'recording:"{title}"'
        if track.artists:
            query += f' AND artist:"{track.artists[0]}"'
        data = self._get(
            "recording",
            {
                "query": query,
                "inc": "artist-credits+releases+release-groups",
                "limit": 10,
                "fmt": "json",
            },
        )
        source_tokens = _words(track.title)
        source_artists = {_name(a) for a in track.artists}
        candidates = []
        for recording in (data or {}).get("recordings") or []:
            candidate_title = recording.get("title") or ""
            candidate_tokens = _words(candidate_title)
            overlap = (
                len(source_tokens & candidate_tokens) / len(source_tokens | candidate_tokens)
                if source_tokens and candidate_tokens
                else 0
            )
            similarity = SequenceMatcher(
                None,
                _search_title(track.title).casefold(),
                _search_title(candidate_title).casefold(),
            ).ratio()
            names = {
                _name((credit.get("artist") or {}).get("name") or "")
                for credit in recording.get("artist-credit") or []
            }
            if source_artists and not source_artists.intersection(names):
                continue
            if not source_tokens or overlap < 0.3 or similarity < 0.55:
                continue
            if _marked(track.title) and not _marked(candidate_title):
                continue
            score = float(recording.get("score") or 0) + overlap * 100 + similarity * 25
            candidates.append((score, recording))
        if not candidates:
            return None
        candidates.sort(key=lambda item: item[0], reverse=True)
        return self._result([candidates[0][1]], "search", track.album)

    def resolve(self, track: SourceTrack) -> MusicBrainzResult:
        reasons = []
        normalized_isrc = (track.isrc or "").replace("-", "").strip().upper()
        if normalized_isrc and _ISRC.fullmatch(normalized_isrc):
            result = self._by_isrc(normalized_isrc, track)
            if result:
                return result
            reasons.append("isrc_lookup_empty")
        elif normalized_isrc:
            reasons.append("invalid_isrc")
        else:
            reasons.append("no_isrc")
        logger.warning(
            "Falling back to MusicBrainz search: %s — %s",
            track.artists[0] if track.artists else "Unknown",
            track.title,
        )
        result = self._by_search(track)
        if result:
            return result
        reasons.append("search_empty")
        return MusicBrainzResult(failure_reason=";".join(reasons))

    @staticmethod
    def _candidate(recording: dict, track: SourceTrack) -> MusicBrainzCandidate | None:
        result = MusicBrainzClient._result([recording], "manual_search", track.album)
        if result is None:
            return None
        candidate_title = recording.get("title") or ""
        source_title = _search_title(track.title).casefold()
        title_similarity = SequenceMatcher(
            None, source_title, _search_title(candidate_title).casefold()
        ).ratio()
        candidate_artists = {_name(name) for name in result.artist_names}
        source_artists = {_name(name) for name in track.artists}
        artist_match = bool(source_artists.intersection(candidate_artists))
        candidate_isrcs = _unique(recording.get("isrcs") or [])
        normalized_isrc = (track.isrc or "").replace("-", "").upper()
        isrc_match = bool(normalized_isrc and normalized_isrc in candidate_isrcs)
        duration = recording.get("length")
        duration_delta = (
            int(duration) - track.duration_ms
            if duration is not None and track.duration_ms is not None
            else None
        )
        releases = []
        for release in recording.get("releases") or []:
            group = release.get("release-group") or {}
            releases.append(
                {
                    "id": release.get("id") or "",
                    "title": release.get("title") or "",
                    "date": release.get("date") or "",
                    "release_group_id": group.get("id") or "",
                    "release_group_title": group.get("title") or "",
                    "primary_type": group.get("primary-type") or "",
                    "secondary_types": tuple(group.get("secondary-types") or ()),
                }
            )
        all_groups = _unique(item["release_group_id"] for item in releases)
        all_releases = _unique(item["id"] for item in releases)
        if all_groups:
            result = MusicBrainzResult(
                result.resolved_via,
                result.recording_title,
                result.artist_names,
                result.recording_ids,
                all_releases,
                all_groups,
                result.artist_ids,
                result.primary_artist_id,
                result.failure_reason,
            )
        score = float(recording.get("score") or 0) + title_similarity * 25
        if artist_match:
            score += 100
        if isrc_match:
            score += 1000
        return MusicBrainzCandidate(
            result=result,
            duration_ms=int(duration) if duration is not None else None,
            isrcs=candidate_isrcs,
            releases=tuple(releases),
            score=score,
            evidence={
                "title_similarity": round(title_similarity, 4),
                "artist_match": artist_match,
                "isrc_match": isrc_match,
                "duration_delta_ms": duration_delta,
                "source_title": track.title,
                "candidate_title": candidate_title,
                "source_artists": list(track.artists),
                "candidate_artists": list(result.artist_names),
            },
        )

    def search_candidates(
        self, track: SourceTrack, query: str | None = None, limit: int = 10
    ) -> list[MusicBrainzCandidate]:
        title = query.strip() if query else _search_title(track.title)
        search_query = f'recording:"{title}"'
        if not query and track.artists:
            search_query += f' AND artist:"{track.artists[0]}"'
        data = self._get(
            "recording",
            {
                "query": search_query,
                "inc": "artist-credits+isrcs+releases+release-groups",
                "limit": max(1, min(limit, 50)),
                "fmt": "json",
            },
        )
        candidates = [
            candidate
            for recording in (data or {}).get("recordings") or []
            if (candidate := self._candidate(recording, track)) is not None
        ]
        return sorted(candidates, key=lambda item: item.score, reverse=True)

    def validate_recording_mbid(self, mbid: str, track: SourceTrack) -> ManualValidation:
        normalized = mbid.strip().lower()
        if not _MBID.fullmatch(normalized):
            return ManualValidation("invalid", errors=("invalid_recording_mbid_format",))
        data = self._get(
            f"recording/{normalized}",
            {
                "inc": "artist-credits+isrcs+releases+release-groups",
                "fmt": "json",
            },
        )
        if not data or data.get("id") != normalized:
            return ManualValidation("invalid", errors=("recording_not_found",))
        candidate = self._candidate(data, track)
        if candidate is None:
            return ManualValidation("invalid", errors=("recording_metadata_unavailable",))
        evidence = candidate.evidence or {}
        warnings = []
        if not evidence.get("artist_match"):
            warnings.append("artist_differs")
        if float(evidence.get("title_similarity") or 0) < 0.55:
            warnings.append("title_differs")
        delta = evidence.get("duration_delta_ms")
        if delta is not None and abs(int(delta)) > 10_000:
            warnings.append("duration_differs")
        normalized_isrc = (track.isrc or "").replace("-", "").upper()
        if normalized_isrc and candidate.isrcs and normalized_isrc not in candidate.isrcs:
            warnings.append("isrc_differs")
        if not candidate.result.release_group_ids:
            warnings.append("release_group_missing")
        elif len(candidate.result.release_group_ids) > 1:
            warnings.append("release_group_ambiguous")
        return ManualValidation("warning" if warnings else "valid", candidate, tuple(warnings))
