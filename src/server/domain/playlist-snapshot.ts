import { createHash } from "node:crypto";
import type { AcquiredTrack } from "./playlist";

export function playlistSnapshotToken(entries: AcquiredTrack[]): string {
  const normalized = entries.map(({ position, track, skipReason }) => ({
    position,
    sourceTrackId: track.sourceTrackId,
    title: track.title,
    artists: track.artists,
    album: track.album,
    isrc: track.isrc ?? null,
    durationMs: track.durationMs ?? null,
    skipReason: skipReason ?? null,
  }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
