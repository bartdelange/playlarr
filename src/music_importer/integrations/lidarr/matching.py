"""Provider-payload matching rules for downloaded Lidarr tracks."""

import re
import unicodedata

from ...domain.models import MusicBrainzResult

_VARIOUS_ARTISTS_MBID = "89ad4ac3-39f7-470e-963a-56509c546377"
_VERSION_QUALIFIER = re.compile(
    r"\s*[\[(][^\])]*\b(?:edit|mix|remix|version|rework|remaster(?:ed)?|radio|extended|live)\b"
    r"[^\])]*[\])]\s*$",
    re.IGNORECASE,
)


def _is_various_artists(artist: dict) -> bool:
    return (
        artist.get("foreignArtistId") == _VARIOUS_ARTISTS_MBID
        or (artist.get("artistName") or "").casefold() == "various artists"
    )


def _is_various_artists_album(album: dict) -> bool:
    return _is_various_artists(album.get("artist") or {})


def _normalized_title(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).casefold()
    return "".join(character for character in value if character.isalnum())


def _title_fallback_matches(requested: str, downloaded: str) -> bool:
    comparable_requested = _normalized_title(_VERSION_QUALIFIER.sub("", requested))
    comparable_downloaded = _normalized_title(_VERSION_QUALIFIER.sub("", downloaded))
    if not requested or comparable_requested != comparable_downloaded:
        return False
    return (
        not _VERSION_QUALIFIER.search(requested)
        or not _VERSION_QUALIFIER.search(downloaded)
        or _normalized_title(requested) == _normalized_title(downloaded)
    )


def _downloaded_track_keys(tracks: list[dict]) -> tuple[set[str], set[str]]:
    downloaded = [track for track in tracks if track.get("hasFile")]
    recording_ids = {
        identifier
        for track in downloaded
        for identifier in (track.get("foreignRecordingId"), track.get("foreignTrackId"))
        if identifier
    }
    return recording_ids, {track.get("title") or "" for track in downloaded}


def _represented_by_download(
    result: MusicBrainzResult, recording_ids: set[str], titles: set[str]
) -> bool:
    return bool(recording_ids.intersection(result.recording_ids)) or bool(
        result.recording_title
        and any(_title_fallback_matches(result.recording_title, title) for title in titles)
    )


def _downloaded_album_match(
    result: MusicBrainzResult, tracks: list[dict], albums_by_id: dict[int, dict]
) -> tuple[str | None, dict | None, str]:
    downloaded = [track for track in tracks if track.get("hasFile")]
    match = next(
        (
            track
            for track in downloaded
            if {track.get("foreignRecordingId"), track.get("foreignTrackId")}.intersection(
                result.recording_ids
            )
        ),
        None,
    )
    method = "recording_id"
    if match is None and result.recording_title:
        match = next(
            (
                track
                for track in downloaded
                if _title_fallback_matches(result.recording_title, track.get("title") or "")
            ),
            None,
        )
        method = "normalized_title"
    album = albums_by_id.get(match.get("albumId")) if match else None
    return (album.get("foreignAlbumId") if album else None, match, method)


def _downloaded_album_group(
    result: MusicBrainzResult, tracks: list[dict], albums_by_id: dict[int, dict]
) -> str | None:
    return _downloaded_album_match(result, tracks, albums_by_id)[0]


def _matched_track_payload(track: dict, match_method: str) -> dict:
    return {
        "id": track.get("id"),
        "title": track.get("title", ""),
        "track_number": track.get("trackNumber") or track.get("absoluteTrackNumber"),
        "foreign_recording_id": track.get("foreignRecordingId") or track.get("foreignTrackId"),
        "track_file_id": track.get("trackFileId"),
        "has_file": bool(track.get("hasFile")),
        "match_method": match_method,
    }
