import { expect, it, vi } from "vitest";
import { refreshLibraryStatus } from "../../server/application/library-status";

it("finds downloaded paths by recording ID and classifies missing releases", async () => {
  const client = {
    artists: vi.fn(async () => [
      { id: 7, foreignArtistId: "artist", path: "/music/Artist" },
    ]),
    trackFilesByArtistId: vi.fn(async () => [
      { id: 9, relativePath: "Album/Song.flac" },
    ]),
    tracksByArtistId: vi.fn(async () => [
      { foreignRecordingId: "recording", hasFile: true, trackFileId: 9 },
    ]),
    albumsByForeignId: vi.fn(async () => []),
    tracksByAlbumId: vi.fn(async () => []),
  };
  const statuses = await refreshLibraryStatus(
    [
      {
        resolvedVia: "isrc",
        recordingTitle: "Song",
        recordingIds: ["recording"],
        primaryArtistId: "artist",
        releaseGroupIds: ["group"],
      },
      {
        resolvedVia: "search",
        recordingTitle: "Missing",
        primaryArtistId: "artist",
        releaseGroupIds: ["missing"],
      },
      {},
    ],
    client,
  );
  expect(statuses).toEqual([
    {
      position: 0,
      classification: "represented_locally",
      path: "/music/Artist/Album/Song.flac",
    },
    { position: 1, classification: "release_missing", path: undefined },
    { position: 2, classification: "musicbrainz_unresolved", path: undefined },
  ]);
});

it("recognizes files on globally owned and Various Artists albums without authorizing mutation", async () => {
  const client = {
    artists: async () => [{ id: 7, foreignArtistId: "artist" }],
    trackFilesByArtistId: async (id: number) =>
      id === 99 ? [{ id: 3, path: "/music/Compilation/Song.flac" }] : [],
    tracksByArtistId: async () => [],
    albumsByForeignId: async () => [
      {
        id: 20,
        artistId: 99,
        foreignAlbumId: "compilation",
        artist: {
          id: 99,
          foreignArtistId: "89ad4ac3-39f7-470e-963a-56509c546377",
        },
      },
    ],
    tracksByAlbumId: async () => [
      { foreignRecordingId: "recording", hasFile: true, trackFileId: 3 },
    ],
  };
  const [status] = await refreshLibraryStatus(
    [
      {
        recordingIds: ["recording"],
        primaryArtistId: "artist",
        releaseGroupIds: ["compilation"],
      },
    ],
    client,
  );
  expect(status).toEqual({
    position: 0,
    classification: "represented_locally",
    path: "/music/Compilation/Song.flac",
  });
});
