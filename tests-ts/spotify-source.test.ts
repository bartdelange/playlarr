import { expect, it, vi } from "vitest";
import { SpotifySource } from "../src/server/integrations/spotify/source";
const tokens = { accessToken: async () => "token" };
it("parses playlist references and preserves ordered duplicate and skipped occurrences", async () => {
  expect(
    SpotifySource.playlistId("https://open.spotify.com/playlist/abc?si=x"),
  ).toBe("abc");
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      items: [
        null,
        {
          is_local: false,
          item: {
            id: "same",
            type: "track",
            name: "Song",
            artists: [{ name: "Artist" }],
            album: { name: "Album" },
            external_ids: { isrc: "USABC1234567" },
          },
        },
        {
          is_local: false,
          item: {
            id: "same",
            type: "track",
            name: "Song",
            artists: [{ name: "Artist" }],
            album: { name: "Album" },
          },
        },
      ],
      next: null,
    }),
  );
  const entries = await new SpotifySource(tokens, fetcher).getEntries({
    source: "spotify",
    id: "list",
    name: "List",
  });
  expect(entries.map((entry) => entry.position)).toEqual([0, 1, 2]);
  expect(entries[0].skipReason).toBe("unavailable track");
  expect(entries.slice(1).map((entry) => entry.track.sourceTrackId)).toEqual([
    "same",
    "same",
  ]);
});
it("marks followed playlists while retaining collaborative playlists", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      items: [
        { id: "mine", name: "Mine", owner: { id: "me" } },
        { id: "followed", owner: { id: "other" } },
        { id: "shared", owner: { id: "other" }, collaborative: true },
      ],
      next: null,
    }),
  );
  const lists = await new SpotifySource(tokens, fetcher, "me").listPlaylists();
  expect(lists.map((list) => list.isFollowed)).toEqual([false, true, false]);
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer token");
});
