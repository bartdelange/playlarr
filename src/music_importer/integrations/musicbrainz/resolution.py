import logging
from difflib import SequenceMatcher

from ...domain.models import MusicBrainzResult, SourceTrack
from .matching import (
    ISRC_PATTERN,
    marked,
    name_key,
    release_score,
    search_title,
    unique_values,
    version_preference,
    words,
)

logger = logging.getLogger("music_importer.integrations.musicbrainz.client")


class ResolutionClient:
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
            selected = max(releases, key=lambda release: release_score(release, source_album))
            selected_group = (selected.get("release-group") or {}).get("id")
            group_ids.append(selected_group)
            release_ids.extend(
                release.get("id")
                for release in releases
                if (release.get("release-group") or {}).get("id") == selected_group
            )
        ids = unique_values(recording_ids)
        if not ids:
            return None
        first = recordings[0]
        names = unique_values(
            (entry.get("artist") or {}).get("name") for entry in first.get("artist-credit") or []
        )
        return MusicBrainzResult(
            via,
            first.get("title") or "",
            names,
            ids,
            unique_values(release_ids),
            unique_values(group_ids),
            unique_values(artist_ids),
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
        title = search_title(track.title)
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
        source_tokens = words(track.title)
        source_artists = {name_key(a) for a in track.artists}
        candidates = []
        for recording in (data or {}).get("recordings") or []:
            candidate_title = recording.get("title") or ""
            candidate_tokens = words(candidate_title)
            overlap = (
                len(source_tokens & candidate_tokens) / len(source_tokens | candidate_tokens)
                if source_tokens and candidate_tokens
                else 0
            )
            similarity = SequenceMatcher(
                None,
                search_title(track.title).casefold(),
                search_title(candidate_title).casefold(),
            ).ratio()
            names = {
                name_key((credit.get("artist") or {}).get("name") or "")
                for credit in recording.get("artist-credit") or []
            }
            if source_artists and not source_artists.intersection(names):
                continue
            if (
                not source_tokens
                or overlap < 0.3
                or (similarity < 0.55 and candidate_tokens != source_tokens)
            ):
                continue
            if marked(track.title) and not marked(candidate_title):
                continue
            score = float(recording.get("score") or 0) + overlap * 100 + similarity * 25
            candidates.append((score, candidate_tokens, recording))
        if not candidates:
            return None
        exact_base_candidates = [item for item in candidates if item[1] == source_tokens]
        ranked = exact_base_candidates or candidates
        ranked.sort(
            key=lambda item: (version_preference(item[2].get("title") or ""), item[0]),
            reverse=True,
        )
        return self._result([ranked[0][2]], "search", track.album)

    def resolve(self, track: SourceTrack) -> MusicBrainzResult:
        reasons = []
        normalized_isrc = (track.isrc or "").replace("-", "").strip().upper()
        if normalized_isrc and ISRC_PATTERN.fullmatch(normalized_isrc):
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
