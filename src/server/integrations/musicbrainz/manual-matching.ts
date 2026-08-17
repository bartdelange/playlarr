import type { SourceTrack } from "../../domain/playlist";
import { candidates, validationWarnings, type Candidate, type ManualValidation } from "./candidates";
import type { MusicBrainzQuery } from "./orchestrator";
import type { MusicBrainzRecording } from "./resolution";

const mbidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ManualMusicBrainzMatcher {
  constructor(private readonly client: MusicBrainzQuery) {}

  async search(track: SourceTrack, query?: string, limit = 10): Promise<Candidate[]> {
    const title = query?.trim() || track.title.replace(/\s*[([](?:feat|ft)\.?[^)\]]*[)\]]/gi, "").trim();
    const searchQuery = `recording:"${title}"${!query && track.artists[0] ? ` AND artist:"${track.artists[0]}"` : ""}`;
    const data = await this.client.get("recording", { query: searchQuery, inc: "artist-credits+isrcs+releases+release-groups", limit: String(Math.max(1, Math.min(limit, 50))), fmt: "json" });
    return candidates(track, Array.isArray(data.recordings) ? data.recordings as MusicBrainzRecording[] : []);
  }

  async validateRecordingMbid(mbid: string, track: SourceTrack): Promise<ManualValidation> {
    const normalized = mbid.trim().toLowerCase();
    if (!mbidPattern.test(normalized)) return { status: "invalid", warnings: [], errors: ["invalid_recording_mbid_format"] };
    const data = await this.client.get(`recording/${normalized}`, { inc: "artist-credits+isrcs+releases+release-groups", fmt: "json" });
    if (!data || data.id !== normalized) return { status: "invalid", warnings: [], errors: ["recording_not_found"] };
    const candidate = candidates(track, [data as MusicBrainzRecording])[0];
    if (!candidate) return { status: "invalid", warnings: [], errors: ["recording_metadata_unavailable"] };
    const warnings = validationWarnings(candidate);
    return { status: warnings.length ? "warning" : "valid", candidate, warnings, errors: [] };
  }
}
