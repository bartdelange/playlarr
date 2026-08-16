import re
from difflib import SequenceMatcher

ISRC_PATTERN = re.compile(r"^[A-Z]{2}[A-Z0-9]{3}\d{7}$")
MBID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.IGNORECASE
)
VERSION_WORDS = {"remix", "edit", "extended", "radio", "club", "vip", "mix"}
STOPWORDS = VERSION_WORDS | {
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


def unique_values(values):
    return tuple(dict.fromkeys(value for value in values if value))


def words(value: str) -> set[str]:
    return {word for word in re.findall(r"[a-z0-9]+", value.casefold()) if word not in STOPWORDS}


def name_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def marked(title: str) -> bool:
    return bool(set(re.findall(r"[a-z]+", title.casefold())) & VERSION_WORDS)


def version_preference(title: str) -> int:
    words = set(re.findall(r"[a-z]+", title.casefold()))
    if "extended" in words:
        return 2
    if words.intersection({"radio", "edit"}):
        return 0
    return 1


def search_title(title: str) -> str:
    title = re.sub(r"\s*[([](?:feat|ft)\.?[^)\]]*[)\]]", "", title, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", title).strip()


def release_score(release: dict, source_album: str) -> float:
    group = release.get("release-group") or {}
    source = name_key(source_album)
    titles = [name_key(release.get("title") or ""), name_key(group.get("title") or "")]
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
