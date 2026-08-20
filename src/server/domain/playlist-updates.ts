import type { AcquiredTrack, StoredEntry } from "./playlist";
export interface PlaylistChange {
  state: "added" | "removed" | "updated" | "moved" | "unchanged";
  oldPosition?: number;
  newPosition?: number;
  changedFields: string[];
  oldTrack?: StoredEntry["track"];
  newTrack?: AcquiredTrack["track"];
}
export interface PlaylistUpdate {
  added: number;
  removed: number;
  updated: number;
  moved: number;
  unchanged: number;
  changes: PlaylistChange[];
}
function changed(old: StoredEntry, next: AcquiredTrack): string[] {
  const fields: [string, unknown, unknown][] = [
    ["title", old.track.title, next.track.title],
    ["artists", old.track.artists, next.track.artists],
    ["album", old.track.album, next.track.album],
    ["ISRC", old.track.isrc, next.track.isrc],
    ["duration", old.track.durationMs, next.track.durationMs],
  ];
  return fields
    .filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b))
    .map(([name]) => name);
}
export function previewPlaylistUpdate(
  previous: StoredEntry[],
  current: AcquiredTrack[],
): PlaylistUpdate {
  const unmatched = new Map(previous.map((entry) => [entry.id, entry]));
  const matched = new Map<number, StoredEntry>();
  for (const field of ["sourceTrackId", "isrc"] as const) {
    const buckets = new Map<string, StoredEntry[]>();
    for (const entry of unmatched.values()) {
      const value = entry.track[field];
      if (value) buckets.set(value, [...(buckets.get(value) ?? []), entry]);
    }
    current.forEach((entry, index) => {
      if (matched.has(index)) return;
      const value = entry.track[field];
      const candidates = value ? buckets.get(value) : undefined;
      const old = candidates?.shift();
      if (old) {
        matched.set(index, old);
        unmatched.delete(old.id);
      }
    });
  }
  const changes: PlaylistChange[] = current.map((entry, index) => {
    const old = matched.get(index);
    if (!old)
      return {
        state: "added",
        newPosition: entry.position,
        changedFields: [],
        newTrack: entry.track,
      };
    const changedFields = changed(old, entry);
    return {
      state: changedFields.length
        ? "updated"
        : old.position !== entry.position
          ? "moved"
          : "unchanged",
      oldPosition: old.position,
      newPosition: entry.position,
      changedFields,
      oldTrack: old.track,
      newTrack: entry.track,
    };
  });
  for (const old of unmatched.values())
    changes.push({
      state: "removed",
      oldPosition: old.position,
      changedFields: [],
      oldTrack: old.track,
    });
  const counts = { added: 0, removed: 0, updated: 0, moved: 0, unchanged: 0 };
  changes.forEach((change) => {
    counts[change.state]++;
  });
  return {
    ...counts,
    changes: changes.sort(
      (a, b) =>
        (a.newPosition ?? a.oldPosition ?? 0) -
        (b.newPosition ?? b.oldPosition ?? 0),
    ),
  };
}
