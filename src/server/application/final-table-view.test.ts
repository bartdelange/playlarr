import { describe, expect, it } from "vitest";
import {
  filterFinalRows,
  finalAvailabilityCounts,
  finalTableRows,
  libraryAvailability,
  type FinalTableEntry,
} from "../../server/application/final-table-view";

function entry(overrides: Partial<FinalTableEntry> = {}): FinalTableEntry {
  return {
    id: 8,
    position: 3,
    resolutionState: "automatically_resolved",
    track: {
      source: "spotify",
      sourceTrackId: "source-track",
      title: "Source title",
      artists: ["Source artist"],
      album: "Source album",
    },
    result: {
      resolvedVia: "isrc",
      recordingIds: ["recording-id"],
      releaseGroupIds: ["source-release"],
      primaryArtistId: "artist-id",
    },
    ...overrides,
  };
}

describe("Final table view", () => {
  it("maps the exact matched Lidarr track payload for the persisted recording and release", () => {
    const rows = finalTableRows(
      [entry()],
      [
        {
          action: "reuse_downloaded_release",
          artistMbid: "artist-id",
          releaseGroupId: "lidarr-release",
          albumTitle: "Lidarr album",
          payload: {
            requested_recording_ids: ["recording-id"],
            mapped_release_group_ids: ["source-release"],
            matched_track: {
              title: "Lidarr title",
              track_number: 7,
              foreign_recording_id: "recording-id",
              match_method: "recording_id",
              has_file: true,
              track_file_id: 41,
            },
          },
        },
      ],
    );

    expect(rows[0]).toMatchObject({
      position: 3,
      resolutionState: "automatically_resolved",
      lidarrMatch: {
        title: "Lidarr title",
        trackNumber: 7,
        foreignRecordingId: "recording-id",
        matchMethod: "recording_id",
        hasFile: true,
        trackFileId: 41,
        albumTitle: "Lidarr album",
        releaseGroupId: "lidarr-release",
      },
    });
  });

  it("does not attach a matched payload belonging to another recording", () => {
    const [row] = finalTableRows(
      [entry()],
      [
        {
          action: "reuse_downloaded_release",
          artistMbid: "artist-id",
          releaseGroupId: "source-release",
          payload: {
            requested_recording_ids: ["another-recording"],
            matched_track: { title: "Wrong track" },
          },
        },
      ],
    );

    expect(row.lidarrMatch).toBeUndefined();
  });

  it.each([
    ["represented_locally", undefined, "downloaded"],
    ["release_downloaded", undefined, "downloaded"],
    ["recording_match", undefined, "downloaded"],
    ["alternate_version_title_match", undefined, "downloaded"],
    ["unrecognized", "/music/Artist/Song.flac", "downloaded"],
    ["artist_missing", undefined, "downloadable"],
    ["release_missing", undefined, "downloadable"],
    ["release_unmonitored_missing", undefined, "downloadable"],
    ["release_monitored_missing", undefined, "downloadable"],
    ["musicbrainz_unresolved", undefined, "not_downloadable"],
    ["various_artists_skipped", undefined, "not_downloadable"],
    [undefined, undefined, "not_refreshed"],
  ])("classifies %s with path %s as %s", (classification, path, expected) => {
    expect(libraryAvailability(classification, path)).toBe(expected);
  });

  it("keeps a downloaded file path and makes an executed VA exclusion not downloadable", () => {
    const rows = finalTableRows(
      [
        entry({
          libraryClassification: "represented_locally",
          libraryPath: "/music/Artist/Song.flac",
        }),
        entry({
          id: 9,
          position: 4,
          result: {
            resolvedVia: "manual_mbid",
            recordingIds: ["va-recording"],
            releaseGroupIds: ["va-release"],
            primaryArtistId: "va-artist",
          },
          libraryClassification: "release_monitored_missing",
        }),
      ],
      [
        {
          action: "skip",
          artistMbid: "va-artist",
          releaseGroupId: "va-release",
          reason: "various_artists_album",
        },
      ],
      [{ actionPosition: 0, outcome: "skipped" }],
    );

    expect(rows[0]).toMatchObject({
      availability: "downloaded",
      libraryPath: "/music/Artist/Song.flac",
    });
    expect(rows[1]).toMatchObject({
      availability: "not_downloadable",
      executionNotes: [{ reason: "various_artists_album", outcome: "skipped" }],
    });
    expect(finalAvailabilityCounts(rows)).toEqual({
      downloaded: 1,
      downloadable: 0,
      not_downloadable: 1,
    });
    expect(filterFinalRows(rows, "downloaded").map((row) => row.id)).toEqual([
      8,
    ]);
    expect(
      filterFinalRows(rows, "not_downloadable").map((row) => row.id),
    ).toEqual([9]);
  });
});
