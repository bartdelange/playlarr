import { expect, it, vi } from "vitest";
import {
  planLidarr,
  type LidarrPlanningClient,
} from "../src/server/application/lidarr-planning";
import { LidarrClient } from "../src/server/integrations/lidarr/client";

it("uses the Lidarr v1 API with an API-key header", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json([]));
  const client = new LidarrClient(
    { url: "http://lidarr/", apiKey: "secret" },
    fetcher,
  );
  await client.albumsByArtistId(7);
  expect(fetcher.mock.calls[0][0]).toBe(
    "http://lidarr/api/v1/album?artistId=7",
  );
  expect(fetcher.mock.calls[0][1].headers["X-Api-Key"]).toBe("secret");
});

it("persists exact downloaded recording, release, and file identity as an unchanged match", async () => {
  const client = planningClient({
    artists: [artist()],
    artistAlbums: [album({ monitored: true })],
    artistTracks: [
      {
        id: 31,
        albumId: 20,
        title: "Song",
        trackNumber: "2",
        foreignRecordingId: "recording",
        trackFileId: 91,
        hasFile: true,
      },
    ],
  });

  const plan = await planLidarr([result()], client);

  expect(plan.actions).toContainEqual(
    expect.objectContaining({
      action: "unchanged",
      releaseGroupId: "group",
      albumTitle: "Album",
      reason: "requested_recording_downloaded",
      payload: expect.objectContaining({
        lidarr_album_id: 20,
        requested_recording_ids: ["recording"],
        matched_track: {
          id: 31,
          title: "Song",
          track_number: "2",
          foreign_recording_id: "recording",
          track_file_id: 91,
          has_file: true,
          match_method: "recording_id",
        },
      }),
    }),
  );
  expect(
    plan.actions.filter((action) =>
      ["create_release", "monitor_release", "queue_search"].includes(
        action.action,
      ),
    ),
  ).toEqual([]);
});

it("plans an additive release for an existing artist when the release is missing", async () => {
  const client = planningClient({ artists: [artist()] });

  const plan = await planLidarr([result()], client);

  expect(plan.actions.map((action) => action.action)).toEqual([
    "create_release",
    "monitor_release",
    "queue_search",
  ]);
  expect(plan.actions[1].payload).toEqual({
    requested_recording_ids: ["recording"],
    requested_release_ids: ["release"],
  });
});

it("plans every associated release group instead of taking only the first", async () => {
  const plan = await planLidarr(
    [result({ releaseGroupIds: ["group", "alternate-group"] })],
    planningClient({ artists: [artist()] }),
  );

  expect(
    new Set(
      plan.actions.flatMap((action) =>
        action.releaseGroupId ? [action.releaseGroupId] : [],
      ),
    ),
  ).toEqual(new Set(["group", "alternate-group"]));
});

it("scopes release mutations to only recordings that are still missing", async () => {
  const plan = await planLidarr(
    [
      result({
        recordingIds: ["downloaded"],
        recordingTitle: "Downloaded",
        releaseGroupIds: ["other-edition"],
      }),
      result({ recordingIds: ["missing"], recordingTitle: "Missing" }),
    ],
    planningClient({
      artists: [artist()],
      artistAlbums: [album()],
      artistTracks: [
        {
          albumId: 20,
          title: "Downloaded",
          foreignRecordingId: "downloaded",
          hasFile: true,
        },
      ],
    }),
  );

  expect(
    plan.actions
      .filter((action) =>
        ["monitor_release", "queue_search"].includes(action.action),
      )
      .map((action) => action.payload?.requested_recording_ids),
  ).toEqual([["missing"], ["missing"]]);
});

it("keeps an existing monitored release unchanged but searches for its missing recording", async () => {
  const client = planningClient({
    artists: [artist()],
    artistAlbums: [album({ monitored: true })],
    artistTracks: [
      {
        albumId: 20,
        title: "Song",
        foreignRecordingId: "recording",
        hasFile: false,
      },
    ],
  });

  const plan = await planLidarr([result({ releaseIds: [] })], client);

  expect(plan.actions.map((action) => action.action)).toEqual([
    "unchanged",
    "queue_search",
  ]);
  expect(plan.actions[0].reason).toBe("already_monitored");
  expect(plan.actions[1].payload?.requested_recording_ids).toEqual([
    "recording",
  ]);
});

it("preserves a selected release by planning a pin even when its album is monitored", async () => {
  const client = planningClient({
    artists: [artist()],
    artistAlbums: [
      album({
        monitored: true,
        anyReleaseOk: true,
        releases: [
          { foreignReleaseId: "other", monitored: true },
          { foreignReleaseId: "release", monitored: false },
        ],
      }),
    ],
  });

  const plan = await planLidarr([result()], client);

  expect(
    plan.actions.find((action) => action.action === "monitor_release")?.payload,
  ).toMatchObject({ requested_release_ids: ["release"] });
});

it("reuses a globally existing release instead of creating a duplicate", async () => {
  const global = album({ artistId: 99 });
  const client = planningClient({ globalAlbums: { group: [global] } });

  const plan = await planLidarr([result()], client);

  expect(plan.actions.map((action) => action.action)).toEqual([
    "create_artist",
    "reuse_existing_release",
    "monitor_release",
    "queue_search",
    "monitor_artist",
  ]);
  expect(plan.actions[1].reason).toBe("release_exists_globally");
});

it("protects Various Artists albums unless the recording-scoped override is present", async () => {
  const compilation = album({
    artist: {
      foreignArtistId: "89ad4ac3-39f7-470e-963a-56509c546377",
      artistName: "Various Artists",
    },
  });
  const protectedClient = planningClient({
    artists: [artist()],
    artistAlbums: [compilation],
  });
  const protectedPlan = await planLidarr([result()], protectedClient);
  expect(protectedPlan.actions).toEqual([
    expect.objectContaining({
      action: "skip",
      reason: "various_artists_album",
    }),
  ]);

  const allowedPlan = await planLidarr(
    [result()],
    planningClient({ artists: [artist()], artistAlbums: [compilation] }),
    new Set(["recording"]),
  );
  expect(allowedPlan.actions.some((action) => action.action === "skip")).toBe(
    false,
  );
  expect(
    allowedPlan.actions
      .filter((action) =>
        ["monitor_release", "queue_search"].includes(action.action),
      )
      .every(
        (action) => action.payload?.allow_various_artists_release === true,
      ),
  ).toBe(true);
});

it("skips unresolved and Various Artists source recordings before provider lookups", async () => {
  const client = planningClient();

  const plan = await planLidarr(
    [
      {},
      {
        primaryArtistId: "artist",
        artistNames: ["Artist"],
        recordingIds: ["recording"],
      },
      {
        primaryArtistId: "89ad4ac3-39f7-470e-963a-56509c546377",
        artistNames: ["Various Artists"],
        releaseGroupIds: ["compilation"],
      },
    ],
    client,
  );

  expect(plan.actions.map((action) => action.reason)).toEqual([
    "musicbrainz_unresolved",
    "release_group_unresolved",
    "various_artists_skipped",
  ]);
});

it("uses only the master-compatible title fallback and records its match method", async () => {
  const fallback = await planLidarr(
    [
      result({
        recordingIds: ["different"],
        recordingTitle: "Song (Radio Edit)",
      }),
    ],
    planningClient({
      artists: [artist()],
      artistAlbums: [album()],
      artistTracks: [
        { id: 32, albumId: 20, title: "Song", hasFile: true, trackFileId: 92 },
      ],
    }),
  );
  expect(fallback.actions[0].payload?.matched_track).toMatchObject({
    id: 32,
    match_method: "normalized_title",
  });

  const incompatibleVersions = await planLidarr(
    [result({ recordingIds: ["different"], recordingTitle: "Song (Live)" })],
    planningClient({
      artists: [artist()],
      artistAlbums: [album()],
      artistTracks: [
        { albumId: 20, title: "Song (Radio Edit)", hasFile: true },
      ],
    }),
  );
  expect(
    incompatibleVersions.actions.some(
      (action) => action.action === "queue_search",
    ),
  ).toBe(true);
});

function result(overrides: Record<string, unknown> = {}) {
  return {
    resolvedVia: "isrc",
    recordingTitle: "Song",
    artistNames: ["Artist"],
    recordingIds: ["recording"],
    releaseIds: ["release"],
    releaseGroupIds: ["group"],
    primaryArtistId: "artist",
    ...overrides,
  };
}

function artist(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    foreignArtistId: "artist",
    artistName: "Artist",
    monitored: true,
    monitorNewItems: "none",
    ...overrides,
  };
}

function album(overrides: Record<string, unknown> = {}) {
  return {
    id: 20,
    artistId: 7,
    foreignAlbumId: "group",
    title: "Album",
    monitored: false,
    artist: { id: 7, foreignArtistId: "artist", artistName: "Artist" },
    ...overrides,
  };
}

function planningClient(
  values: {
    artists?: Record<string, unknown>[];
    artistAlbums?: Record<string, unknown>[];
    artistTracks?: Record<string, unknown>[];
    globalAlbums?: Record<string, Record<string, unknown>[]>;
    albumTracks?: Record<number, Record<string, unknown>[]>;
  } = {},
): LidarrPlanningClient {
  return {
    artists: vi.fn(async () => values.artists ?? []),
    albumsByArtistId: vi.fn(async () => values.artistAlbums ?? []),
    albumsByForeignId: vi.fn(async (id) => values.globalAlbums?.[id] ?? []),
    tracksByArtistId: vi.fn(async () => values.artistTracks ?? []),
    tracksByAlbumId: vi.fn(async (id) => values.albumTracks?.[id] ?? []),
    lookup: vi.fn(async () => undefined),
  };
}
