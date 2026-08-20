import { expect, it, vi } from "vitest";
import { LidarrClient } from "../src/server/integrations/lidarr/client";
import { planLidarr } from "../src/server/application/lidarr-planning";
it("uses the Lidarr v1 API with an API-key header", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json([]));
  const client = new LidarrClient(
    { url: "http://lidarr/", apiKey: "secret" },
    fetcher,
  );
  await client.artists();
  expect(fetcher.mock.calls[0][0]).toBe("http://lidarr/api/v1/artist");
  expect(fetcher.mock.calls[0][1].headers["X-Api-Key"]).toBe("secret");
});
it("plans read-only additive actions and refuses Various Artists by default", () => {
  const plan = planLidarr(
    [
      {
        primaryArtistId: "artist",
        artistNames: ["Artist"],
        releaseGroupIds: ["group"],
        recordingIds: ["recording"],
      },
      {
        primaryArtistId: "89ad4ac3-39f7-470e-963a-56509c546377",
        releaseGroupIds: ["va"],
      },
    ],
    new Set(),
    new Set(),
  );
  expect(plan.actions.map((action) => action.action)).toEqual([
    "create_artist",
    "create_release",
    "monitor_release",
    "queue_search",
    "skip",
  ]);
});
it("does not plan mutations for downloaded recordings and pins execution evidence", () => {
  const result = {
    primaryArtistId: "artist",
    releaseGroupIds: ["group"],
    releaseIds: ["release"],
    recordingIds: ["recording"],
  };
  const represented = planLidarr(
    [result],
    new Set(),
    new Set(),
    new Set(),
    new Set([0]),
  );
  expect(represented.actions).toEqual([
    { action: "skip", reason: "represented_locally" },
  ]);
  const missing = planLidarr([result], new Set(["artist"]), new Set());
  expect(
    missing.actions.find((action) => action.action === "create_release")
      ?.payload,
  ).toEqual({
    requested_release_ids: ["release"],
    requested_recording_ids: ["recording"],
  });
});
