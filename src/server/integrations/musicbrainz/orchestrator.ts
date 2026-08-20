import type { MusicBrainzResult } from "../../domain/musicbrainz";
import type { SourceTrack } from "../../domain/playlist";
import {
  isrcPattern,
  marked,
  nameKey,
  searchTitle,
  sequenceSimilarity,
  versionPreference,
  words,
} from "./matching";
import { resultFromRecordings, type MusicBrainzRecording } from "./resolution";

export interface MusicBrainzQuery {
  get(
    path: string,
    parameters: Record<string, string>,
  ): Promise<Record<string, unknown>>;
}

const setsEqual = (left: Set<string>, right: Set<string>) =>
  left.size === right.size && [...left].every((value) => right.has(value));

export class MusicBrainzResolver {
  constructor(private readonly client: MusicBrainzQuery) {}

  async resolve(track: SourceTrack): Promise<MusicBrainzResult> {
    const isrc = (track.isrc ?? "").replace(/-/g, "").trim().toUpperCase();
    const reasons: string[] = [];
    if (isrcPattern.test(isrc)) {
      const result = resultFromRecordings(
        await this.recordings(`isrc:${isrc}`, 100),
        "isrc",
        track.album,
      );
      if (result) return result;
      reasons.push("isrc_lookup_empty");
    } else reasons.push(isrc ? "invalid_isrc" : "no_isrc");

    const recordings = await this.recordings(
      `recording:"${searchTitle(track.title)}"${track.artists[0] ? ` AND artist:"${track.artists[0]}"` : ""}`,
      10,
    );
    const sourceTerms = words(track.title);
    const sourceArtists = new Set(track.artists.map(nameKey));
    const candidates = recordings
      .map((recording) => {
        const title = recording.title ?? "";
        const terms = words(title);
        const overlap =
          sourceTerms.size && terms.size
            ? [...sourceTerms].filter((word) => terms.has(word)).length /
              new Set([...sourceTerms, ...terms]).size
            : 0;
        const similarity = sequenceSimilarity(
          searchTitle(track.title).toLowerCase(),
          searchTitle(title).toLowerCase(),
        );
        const artists = new Set(
          (recording["artist-credit"] ?? []).map((credit) =>
            nameKey(credit.artist?.name ?? ""),
          ),
        );
        const artistMatch =
          !sourceArtists.size ||
          [...sourceArtists].some((artist) => artists.has(artist));
        return {
          recording,
          terms,
          overlap,
          similarity,
          artistMatch,
          score: Number(recording.score ?? 0) + overlap * 100 + similarity * 25,
        };
      })
      .filter(
        ({ recording, terms, overlap, similarity, artistMatch }) =>
          artistMatch &&
          overlap >= 0.3 &&
          (similarity >= 0.55 || setsEqual(terms, sourceTerms)) &&
          (!marked(track.title) || marked(recording.title ?? "")),
      );
    const exact = candidates.filter(({ terms }) =>
      setsEqual(terms, sourceTerms),
    );
    const selected = (exact.length ? exact : candidates).sort(
      (left, right) =>
        versionPreference(right.recording.title ?? "") -
          versionPreference(left.recording.title ?? "") ||
        right.score - left.score,
    )[0];
    const result = selected
      ? resultFromRecordings([selected.recording], "search", track.album)
      : undefined;
    return result ?? { failureReason: [...reasons, "search_empty"].join(";") };
  }

  private async recordings(
    query: string,
    limit: number,
  ): Promise<MusicBrainzRecording[]> {
    const data = await this.client.get("recording", {
      query,
      inc: "artist-credits+releases+release-groups",
      limit: String(limit),
      fmt: "json",
    });
    return Array.isArray(data.recordings)
      ? (data.recordings as MusicBrainzRecording[])
      : [];
  }
}
