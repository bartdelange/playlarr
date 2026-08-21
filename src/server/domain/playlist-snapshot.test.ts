import { expect, it } from "vitest";
import { playlistSnapshotToken } from "../../server/domain/playlist-snapshot";

const snapshot = [
  {
    position: 0,
    track: {
      source: "spotify",
      sourceTrackId: "track-1",
      title: "Song",
      artists: ["Artist"],
      album: "Album",
    },
  },
];

it("binds playlist update approval to the exact ordered source snapshot", () => {
  expect(playlistSnapshotToken(snapshot)).toBe(playlistSnapshotToken(structuredClone(snapshot)));
  expect(playlistSnapshotToken(snapshot)).not.toBe(playlistSnapshotToken([{ ...snapshot[0], position: 1 }]));
  expect(playlistSnapshotToken(snapshot)).not.toBe(
    playlistSnapshotToken([{ ...snapshot[0], track: { ...snapshot[0].track, title: "Changed" } }]),
  );
});
