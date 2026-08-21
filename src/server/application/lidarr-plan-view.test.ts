import { describe, expect, it } from "vitest";
import { type LidarrPlanEntry, lidarrPlanRows, lidarrPlanSummary } from "../../server/application/lidarr-plan-view";

function entry(overrides: Partial<LidarrPlanEntry> = {}): LidarrPlanEntry {
  return {
    id: 12,
    position: 4,
    resolutionState: "automatically_resolved",
    isManual: false,
    track: {
      source: "spotify",
      sourceTrackId: "track-12",
      title: "Source song",
      artists: ["Source artist"],
      album: "Source album",
    },
    result: {
      resolvedVia: "isrc",
      recordingTitle: "Matched song",
      recordingIds: ["recording-12"],
      releaseGroupIds: ["release-12"],
      primaryArtistId: "artist-12",
      artistNames: ["Matched artist"],
    },
    evidence: {},
    ...overrides,
  };
}

describe("Lidarr plan table rows", () => {
  it("derives the legacy plan summary from persisted action semantics", () => {
    expect(
      lidarrPlanSummary({
        actions: [
          { action: "create_artist", artistMbid: "artist-a" },
          {
            action: "reuse_existing_release",
            artistMbid: "artist-a",
            releaseGroupId: "release-a",
          },
          {
            action: "unchanged",
            artistMbid: "artist-b",
            releaseGroupId: "release-b",
          },
          {
            action: "monitor_release",
            artistMbid: "artist-a",
            releaseGroupId: "release-a",
          },
          {
            action: "queue_search",
            artistMbid: "artist-a",
            releaseGroupId: "release-a",
          },
          { action: "skip", reason: "various_artists_album" },
        ],
      }),
    ).toEqual({
      actions: 6,
      changes: 3,
      artists: 2,
      newArtists: 1,
      releases: 2,
      represented: 2,
      monitored: 1,
      searches: 1,
      attention: 1,
    });
  });

  it("keeps source order and persisted resolved and unresolved states", () => {
    const rows = lidarrPlanRows(
      [
        entry(),
        entry({
          id: 13,
          position: 5,
          resolutionState: "unresolved",
          result: {},
        }),
      ],
      {
        actions: [
          {
            action: "create_release",
            artistMbid: "artist-12",
            releaseGroupId: "release-12",
            albumTitle: "Matched album",
            payload: { requested_recording_ids: ["recording-12"] },
          },
        ],
      },
    );

    expect(rows.map((row) => row.entry.position)).toEqual([4, 5]);
    expect(rows[0]).toMatchObject({
      entry: { resolutionState: "automatically_resolved" },
      actionNames: ["create_release"],
      releases: [{ title: "Matched album" }],
    });
    expect(rows[1]).toMatchObject({
      entry: { resolutionState: "unresolved" },
      actionNames: ["skip"],
      mutates: false,
    });
  });

  it("maps artist, release, monitor, search, unchanged, and skip plan states to their recording", () => {
    const actions = [
      { action: "create_artist", artistMbid: "artist-12" },
      {
        action: "create_release",
        artistMbid: "artist-12",
        releaseGroupId: "release-12",
        payload: { requested_recording_ids: ["recording-12"] },
      },
      {
        action: "monitor_release",
        releaseGroupId: "release-12",
        payload: { requested_recording_ids: ["recording-12"] },
      },
      {
        action: "queue_search",
        releaseGroupId: "release-12",
        payload: { requested_recording_ids: ["recording-12"] },
      },
      {
        action: "unchanged",
        releaseGroupId: "other-release",
        payload: { requested_recording_ids: ["other-recording"] },
      },
      { action: "skip", reason: "musicbrainz_unresolved" },
    ];
    const [row] = lidarrPlanRows([entry()], { actions });

    expect(row.actionNames).toEqual(["create_artist", "create_release", "monitor_release", "queue_search"]);
    expect(row.mutates).toBe(true);
  });

  it("rebinds downloaded releases using persisted action payload evidence", () => {
    const [row] = lidarrPlanRows([entry()], {
      actions: [
        {
          action: "reuse_downloaded_release",
          artistMbid: "artist-12",
          releaseGroupId: "lidarr-release",
          albumTitle: "Downloaded album",
          reason: "downloaded_recording_match",
          payload: {
            mapped_release_group_ids: ["release-12"],
            requested_recording_ids: ["recording-12"],
            lidarr_album_id: 42,
            matched_track: {
              title: "Matched song",
              has_file: true,
              track_file_id: 99,
            },
          },
        },
      ],
    });

    expect(row.releases[0]).toMatchObject({
      sourceGroup: "release-12",
      lidarrGroup: "lidarr-release",
      title: "Downloaded album",
      lidarrAlbumId: 42,
      matchedTrack: { has_file: true, track_file_id: 99 },
    });
  });

  it("exposes the Various Artists safety state only from reason and persisted override evidence", () => {
    const plan = {
      actions: [
        {
          action: "skip",
          reason: "various_artists_album",
          releaseGroupId: "release-12",
        },
      ],
    };
    expect(lidarrPlanRows([entry()], plan)[0]).toMatchObject({
      variousArtistsSkip: true,
      variousArtistsOverride: false,
    });
    expect(lidarrPlanRows([entry({ evidence: { allow_various_artists_release: true } })], plan)[0]).toMatchObject({
      variousArtistsSkip: true,
      variousArtistsOverride: true,
    });
  });
});
