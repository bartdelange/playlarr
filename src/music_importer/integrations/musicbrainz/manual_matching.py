import logging
from difflib import SequenceMatcher

from ...domain.models import ManualValidation, MusicBrainzCandidate, MusicBrainzResult, SourceTrack
from .matching import (
    MBID_PATTERN,
    name_key,
    search_title,
    unique_values,
    version_preference,
    words,
)

logger = logging.getLogger("music_importer.integrations.musicbrainz.client")


class ManualMatchingClient:
    def _candidate(self, recording: dict, track: SourceTrack) -> MusicBrainzCandidate | None:
        result = self._result([recording], "manual_search", track.album)
        if result is None:
            return None
        candidate_title = recording.get("title") or ""
        source_title = search_title(track.title).casefold()
        title_similarity = SequenceMatcher(
            None, source_title, search_title(candidate_title).casefold()
        ).ratio()
        candidate_artists = {name_key(name) for name in result.artist_names}
        source_artists = {name_key(name) for name in track.artists}
        artist_match = bool(source_artists.intersection(candidate_artists))
        candidate_isrcs = unique_values(recording.get("isrcs") or [])
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
        all_groups = unique_values(item["release_group_id"] for item in releases)
        all_releases = unique_values(item["id"] for item in releases)
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
                "version_preference": version_preference(candidate_title),
            },
        )

    @staticmethod
    def _candidate_rank(candidate: MusicBrainzCandidate) -> tuple[bool, bool, bool, int, float]:
        evidence = candidate.evidence or {}
        source_title = str(evidence.get("source_title") or "")
        candidate_title = str(evidence.get("candidate_title") or "")
        same_base_title = bool(words(source_title)) and words(source_title) == words(
            candidate_title
        )
        return (
            bool(evidence.get("isrc_match")),
            bool(evidence.get("artist_match")),
            same_base_title,
            version_preference(candidate_title) if same_base_title else 0,
            candidate.score,
        )

    def search_candidates(
        self, track: SourceTrack, query: str | None = None, limit: int = 10
    ) -> list[MusicBrainzCandidate]:
        title = query.strip() if query else search_title(track.title)
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
        return sorted(candidates, key=self._candidate_rank, reverse=True)

    def validate_recording_mbid(self, mbid: str, track: SourceTrack) -> ManualValidation:
        normalized = mbid.strip().lower()
        if not MBID_PATTERN.fullmatch(normalized):
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
