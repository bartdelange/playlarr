import { expect, it } from "vitest";
import { previewPlaylistUpdate } from "../../server/domain/playlist-updates";

const track = (sourceTrackId: string, isrc?: string) => ({
  source: "spotify",
  sourceTrackId,
  title: "Song",
  artists: ["Artist"],
  album: "Album",
  isrc,
});
it("matches duplicate occurrences in stable order without collapsing them", () => {
  const old = [
    {
      id: 1,
      importId: "import",
      position: 0,
      track: track("same", "A"),
      resolutionState: "pending",
      isManual: false,
    },
    {
      id: 2,
      importId: "import",
      position: 1,
      track: track("same", "A"),
      resolutionState: "pending",
      isManual: false,
    },
  ];
  const update = previewPlaylistUpdate(old, [
    { position: 0, track: track("new") },
    { position: 1, track: track("same", "A") },
  ]);
  expect(update).toMatchObject({ added: 1, removed: 1, moved: 1 });
  expect(update.changes.map((change) => change.state)).toEqual(["added", "moved", "removed"]);
  expect(update.changes[0].newTrack).toMatchObject({ sourceTrackId: "new" });
  expect(update.changes[2].oldTrack).toMatchObject({ sourceTrackId: "same" });
});
