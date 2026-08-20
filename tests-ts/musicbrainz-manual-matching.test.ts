import { expect, it, vi } from "vitest";
import { ManualMusicBrainzMatcher } from "../src/server/integrations/musicbrainz/manual-matching";

const track = {
  source: "spotify",
  sourceTrackId: "track",
  title: "Strobe",
  artists: ["deadmau5"],
  album: "Strobe",
  isrc: "USABC1234567",
  durationMs: 601_200,
};
it("rejects malformed recording MBIDs without making a request", async () => {
  const get = vi.fn();
  const matcher = new ManualMusicBrainzMatcher({ get });
  await expect(
    matcher.validateRecordingMbid("invalid", track),
  ).resolves.toMatchObject({
    status: "invalid",
    errors: ["invalid_recording_mbid_format"],
  });
  expect(get).not.toHaveBeenCalled();
});
it("returns legacy warning reasons and complete release evidence", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const matcher = new ManualMusicBrainzMatcher({
    get: async () => ({
      id,
      title: "Different",
      length: 1000,
      isrcs: ["OTHER12345678"],
      "artist-credit": [{ artist: { id: "other", name: "Other" } }],
      releases: [
        {
          id: "release-a",
          title: "One",
          date: "2020",
          "release-group": {
            id: "group-a",
            title: "One",
            "primary-type": "Single",
          },
        },
        {
          id: "release-b",
          title: "Two",
          "release-group": { id: "group-b", title: "Two" },
        },
      ],
    }),
  });
  const validation = await matcher.validateRecordingMbid(id, track);
  expect(validation.status).toBe("warning");
  expect(validation.warnings).toEqual(
    expect.arrayContaining([
      "artist_differs",
      "title_differs",
      "duration_differs",
      "isrc_differs",
      "release_group_ambiguous",
    ]),
  );
  expect(validation.candidate?.result.releaseIds).toEqual([
    "release-a",
    "release-b",
  ]);
});
