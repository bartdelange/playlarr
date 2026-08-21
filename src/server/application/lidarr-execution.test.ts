import { expect, it, vi } from "vitest";
import { executeApprovedPlan } from "../../server/application/lidarr-execution";
import type { LidarrPlanAction } from "../../server/domain/lidarr";

const repository = (actions: LidarrPlanAction[]) => ({
  get: () => ({ status: "approved", plan: { actions } }),
  recordExecution: vi.fn(),
});
const request = async () => undefined;

it("refuses unapproved plans before any Lidarr reads", async () => {
  const artists = vi.fn();
  await expect(
    executeApprovedPlan(
      {
        get: () => ({ status: "superseded", plan: { actions: [] } }),
        recordExecution: () => {},
      },
      { artists, albumsByForeignId: async () => [], request },
      "plan",
    ),
  ).rejects.toThrow("not approved");
  expect(artists).not.toHaveBeenCalled();
});

it("revalidates and safely creates a release through lookup-backed transport", async () => {
  const repo = repository([
    {
      action: "create_release",
      artistMbid: "artist",
      releaseGroupId: "group",
      payload: { requested_release_ids: ["edition"] },
    },
    {
      action: "monitor_release",
      artistMbid: "artist",
      releaseGroupId: "group",
      payload: { requested_release_ids: ["edition"] },
    },
    { action: "queue_search", artistMbid: "artist", releaseGroupId: "group" },
  ]);
  const createAlbum = vi.fn().mockResolvedValue({
    id: 11,
    foreignAlbumId: "group",
    monitored: false,
    anyReleaseOk: false,
    releases: [{ foreignReleaseId: "edition", monitored: true }],
  });
  const mutate = vi.fn(request);
  const results = await executeApprovedPlan(
    repo,
    {
      artists: async () => [{ id: 7, foreignArtistId: "artist" }],
      albumsByForeignId: async () => [],
      createAlbum,
      request: mutate,
    },
    "plan",
  );
  expect(results.map((result) => result.outcome)).toEqual(["created", "updated", "queued"]);
  expect(createAlbum).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), "group", ["edition"]);
  expect(mutate).toHaveBeenLastCalledWith("POST", "command", {
    name: "AlbumSearch",
    albumIds: [11],
  });
});

it("pins a selected edition and does not replay a satisfied search", async () => {
  const album = {
    id: 11,
    foreignAlbumId: "group",
    monitored: true,
    anyReleaseOk: true,
    releases: [
      { foreignReleaseId: "original", monitored: true },
      { foreignReleaseId: "extended", monitored: false },
    ],
  };
  let sentBody: unknown;
  const mutate = vi.fn(async (_method: string, _path: string, body?: unknown) => {
    sentBody = body;
  });
  const downloaded = vi.fn().mockResolvedValue([{ foreignRecordingId: "recording", hasFile: true }]);
  const results = await executeApprovedPlan(
    repository([
      {
        action: "monitor_release",
        artistMbid: "artist",
        releaseGroupId: "group",
        payload: { requested_release_ids: ["extended"] },
      },
      {
        action: "queue_search",
        artistMbid: "artist",
        releaseGroupId: "other",
        payload: { requested_recording_ids: ["recording"] },
      },
    ]),
    {
      artists: async () => [{ foreignArtistId: "artist" }],
      albumsByForeignId: async (group) => [
        {
          ...album,
          foreignAlbumId: group,
          releases: album.releases.map((release) => ({ ...release })),
        },
      ],
      tracksByAlbumId: downloaded,
      request: mutate,
    },
    "plan",
  );
  expect(results).toEqual([
    { outcome: "updated" },
    { outcome: "unchanged", details: "search_precondition_already_satisfied" },
  ]);
  const payload = sentBody as typeof album;
  expect(payload.anyReleaseOk).toBe(false);
  expect(payload.releases.map((release) => release.monitored)).toEqual([false, true]);
});

it("refuses Various Artists release mutations unless the approved action carries an override", async () => {
  const album = {
    id: 11,
    foreignAlbumId: "group",
    monitored: false,
    artist: { foreignArtistId: "89ad4ac3-39f7-470e-963a-56509c546377" },
  };
  const mutate = vi.fn(request);
  const results = await executeApprovedPlan(
    repository([
      {
        action: "monitor_release",
        artistMbid: "artist",
        releaseGroupId: "group",
      },
    ]),
    {
      artists: async () => [],
      albumsByForeignId: async () => [album],
      request: mutate,
    },
    "plan",
  );
  expect(results).toEqual([{ outcome: "skipped", details: "various_artists_album" }]);
  expect(mutate).not.toHaveBeenCalled();
});
