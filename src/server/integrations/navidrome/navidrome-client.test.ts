import { expect, it, vi } from "vitest";
import { NavidromeClient } from "../../../server/integrations/navidrome/client";

it("uses Subsonic token authentication without exposing the password", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      "subsonic-response": {
        status: "ok",
        searchResult3: {
          song: [{ id: "1", title: "Song", artist: "Artist", path: "A/S.flac" }],
        },
      },
    }),
  );
  const client = new NavidromeClient(
    { url: "http://navidrome/", username: "user", password: "secret" },
    fetcher,
    () => "fixedsalt",
  );
  const songs = await client.searchSongs("song");
  expect(songs[0].path).toBe("A/S.flac");
  const url = new URL(String(fetcher.mock.calls[0][0]));
  expect(url.searchParams.has("p")).toBe(false);
  expect([...url.searchParams.values()]).not.toContain("secret");
  expect(url.searchParams.get("t")).toMatch(/^[0-9a-f]{32}$/);
});
it("omits missing songs from export paths while preserving input positions", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        "subsonic-response": {
          status: "failed",
          error: { message: "Not found" },
        },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        "subsonic-response": {
          status: "ok",
          song: { id: "2", path: "B.flac" },
        },
      }),
    );
  const paths = await new NavidromeClient(
    { url: "http://navidrome", username: "user", password: "secret" },
    fetcher,
  ).paths(["gone", "present"]);
  expect([...paths]).toEqual([[1, "B.flac"]]);
});
