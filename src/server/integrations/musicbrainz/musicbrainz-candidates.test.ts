import { expect, it } from "vitest";
import { candidates, validateCandidate } from "../../../server/integrations/musicbrainz/candidates";

it("ranks an ISRC candidate first and marks weak manual candidates as warnings", () => {
  const track = {
    source: "spotify",
    sourceTrackId: "track",
    title: "Song",
    artists: ["Artist"],
    album: "Album",
    isrc: "USABC1234567",
    durationMs: 1000,
  };
  const [best, weak] = candidates(track, [
    {
      id: "weak",
      title: "Elsewhere",
      "artist-credit": [{ artist: { id: "other", name: "Other" } }],
    },
    {
      id: "best",
      title: "Song",
      isrcs: ["USABC1234567"],
      length: 1000,
      "artist-credit": [{ artist: { id: "artist", name: "Artist" } }],
      releases: [{ id: "release", "release-group": { id: "group" } }],
    },
  ]);
  expect(best.result.recordingIds).toEqual(["best"]);
  expect(validateCandidate(best)).toBe("valid");
  expect(validateCandidate(weak)).toBe("warning");
});
