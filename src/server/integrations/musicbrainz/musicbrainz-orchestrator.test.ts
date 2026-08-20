import { expect, it } from "vitest";
import { MusicBrainzResolver } from "../../../server/integrations/musicbrainz/orchestrator";
it("uses ISRC before selecting the single best artist/title fallback", async () => {
  const queries: string[] = [];
  const resolver = new MusicBrainzResolver({
    get: async (_path, parameters) => {
      queries.push(parameters.query);
      if (parameters.query.startsWith("isrc")) return { recordings: [] };
      return {
        recordings: [
          {
            id: "b",
            title: "Song",
            "artist-credit": [{ artist: { id: "artist", name: "Artist" } }],
          },
          {
            id: "a",
            title: "Song (Radio Edit)",
            "artist-credit": [{ artist: { id: "artist", name: "Artist" } }],
          },
        ],
      };
    },
  });
  const result = await resolver.resolve({
    source: "spotify",
    sourceTrackId: "track",
    title: "Song",
    artists: ["Artist"],
    album: "Album",
    isrc: "US-ABC-12-34567",
  });
  expect(result).toMatchObject({ resolvedVia: "search", recordingIds: ["b"] });
  expect(queries[0]).toBe("isrc:USABC1234567");
});
