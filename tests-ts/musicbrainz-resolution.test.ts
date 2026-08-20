import { expect, it } from "vitest";
import { resultFromRecordings } from "../src/server/integrations/musicbrainz/resolution";
it("selects releases for the best matching release group and retains all recording identities", () => {
  const result = resultFromRecordings(
    [
      {
        id: "one",
        title: "Song",
        "artist-credit": [{ artist: { id: "artist", name: "Artist" } }],
        releases: [
          {
            id: "compilation",
            title: "Hits",
            "release-group": {
              id: "compilation",
              title: "Hits",
              "secondary-types": ["Compilation"],
            },
          },
          {
            id: "album",
            title: "Album",
            "release-group": { id: "album-group", title: "Album" },
          },
        ],
      },
      { id: "two", releases: [] },
    ],
    "isrc",
    "Album",
  );
  expect(result).toMatchObject({
    recordingIds: ["one", "two"],
    releaseGroupIds: ["album-group"],
    releaseIds: ["album"],
    primaryArtistId: "artist",
  });
});
