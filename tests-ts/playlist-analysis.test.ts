import { expect, it, vi } from "vitest";
import { analyzePlaylist } from "../src/server/application/playlist-analysis";

it("analyzes fetched playlist tracks and persists master-equivalent impact counts", async () => {
  const savePlaylistAnalysis = vi.fn();
  const progress = vi.fn();
  await analyzePlaylist(
    "spotify",
    "playlist",
    {
      getPlaylist: async () => ({
        source: "spotify",
        id: "playlist",
        name: "Mix",
        trackCount: 2,
      }),
      getEntries: async () => [
        { position: 0, track: track("One") },
        { position: 1, track: track("Two") },
      ],
    },
    {
      resolve: async (source) =>
        source.title === "One"
          ? {
              resolvedVia: "isrc",
              primaryArtistId: "new-artist",
              artistNames: ["New Artist"],
              releaseGroupIds: ["group"],
            }
          : { failureReason: "not found" },
    },
    {
      artists: async () => [],
      albumsByForeignId: async () => [],
      tracksByArtistId: async () => [],
      tracksByAlbumId: async () => [],
      trackFilesByArtistId: async () => [],
    },
    { savePlaylistAnalysis },
    progress,
    () => false,
  );

  expect(savePlaylistAnalysis).toHaveBeenCalledWith(
    "spotify",
    "playlist",
    "Mix",
    "complete",
    {
      tracks: 2,
      resolved: 1,
      unresolved: 1,
      artists_to_add: 1,
      artist_names: ["New Artist"],
    },
  );
  expect(progress).toHaveBeenCalledWith(2, 2, "Artist — Two");
});

it("persists followed-playlist analysis as skipped without loading tracks", async () => {
  const getEntries = vi.fn();
  const savePlaylistAnalysis = vi.fn();
  await analyzePlaylist(
    "spotify",
    "followed",
    {
      getPlaylist: async () => ({
        source: "spotify",
        id: "followed",
        name: "Followed",
        isFollowed: true,
      }),
      getEntries,
    },
    { resolve: vi.fn() },
    {} as never,
    { savePlaylistAnalysis },
    vi.fn(),
    () => false,
  );
  expect(getEntries).not.toHaveBeenCalled();
  expect(savePlaylistAnalysis).toHaveBeenCalledWith(
    "spotify",
    "followed",
    "Followed",
    "skipped_followed",
    {},
  );
});

function track(title: string) {
  return {
    source: "spotify",
    sourceTrackId: title,
    title,
    artists: ["Artist"],
    album: "Album",
  };
}
