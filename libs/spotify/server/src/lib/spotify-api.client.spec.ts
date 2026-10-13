import { readFile } from 'node:fs/promises';

import { BadGatewayException, UnauthorizedException } from '@nestjs/common';

import { SpotifyApiClient } from './spotify-api.client.js';
import type { SpotifyService } from './spotify.service.js';

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'),
  );
}

function client() {
  const spotify = {
    getAccessToken: vi.fn().mockResolvedValue('access-one'),
    refreshRejectedAccessToken: vi.fn().mockResolvedValue('access-two'),
  };
  return {
    api: new SpotifyApiClient(spotify as unknown as SpotifyService),
    spotify,
  };
}

describe('SpotifyApiClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a stable normalized playlist catalogue across every page', async () => {
    const { api } = client();
    const firstPage = await fixture('playlists-page-1');
    const secondPage = await fixture('playlists-page-2');
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          ...(firstPage as object),
          items: Array.from(
            { length: 50 },
            () => (firstPage as { items: unknown[] }).items[0],
          ),
          limit: 50,
          next: 'https://api.spotify.com/v1/me/playlists?limit=50&offset=50',
          total: 51,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...(secondPage as object),
          limit: 50,
          offset: 50,
          total: 51,
        }),
      );

    const playlists = await api.getPlaylists();

    expect(playlists).toHaveLength(51);
    expect(playlists[0]).toEqual({
      id: 'playlist-one',
      name: 'First playlist',
      owner: { id: 'owner-one', displayName: 'Listener' },
      itemCount: 5,
      snapshotId: 'snapshot-one',
    });
    expect(playlists[50]).toEqual({
      id: 'playlist-two',
      name: 'Second playlist',
      owner: { id: 'owner-two', displayName: null },
      itemCount: 2,
      snapshotId: 'snapshot-two',
    });
    expect(provider.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.spotify.com/v1/me/playlists?limit=50&offset=0',
      'https://api.spotify.com/v1/me/playlists?limit=50&offset=50',
    ]);
  });

  it('preserves source order and duplicates while classifying non-standard items', async () => {
    const { api } = client();
    const firstPage = await fixture('playlist-items-page-1');
    const secondPage = await fixture('playlist-items-page-2');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        ...(firstPage as object),
        items: [
          ...(firstPage as { items: unknown[] }).items,
          ...(secondPage as { items: unknown[] }).items,
        ],
        limit: 50,
        next: null,
      }),
    );

    const contents = await api.getPlaylistContents('selected');

    expect(contents.playlistId).toBe('selected');
    expect(contents.tracks).toEqual([
      {
        position: 0,
        status: 'available',
        sourceId: 'track-one',
        name: 'Repeated song',
        artists: ['Artist one', 'Artist two'],
        album: 'Album one',
        durationMs: 123456,
        discNumber: 1,
        trackNumber: 4,
      },
      {
        position: 1,
        status: 'available',
        sourceId: 'track-one',
        name: 'Repeated song',
        artists: ['Artist one', 'Artist two'],
        album: 'Album one',
        durationMs: 123456,
        discNumber: 1,
        trackNumber: 4,
      },
      { position: 2, status: 'unavailable' },
      { position: 3, status: 'local' },
      { position: 4, status: 'unsupported' },
      { position: 5, status: 'unavailable' },
    ]);
  });

  it('fetches current metadata for one selected playlist', async () => {
    const { api } = client();
    const provider = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        id: 'selected',
        name: 'Selected playlist',
        owner: { id: 'owner-one', display_name: 'Listener' },
        snapshot_id: 'snapshot-current',
        tracks: { total: 6 },
      }),
    );

    await expect(api.getPlaylist('selected')).resolves.toEqual({
      id: 'selected',
      name: 'Selected playlist',
      owner: { id: 'owner-one', displayName: 'Listener' },
      itemCount: 6,
      snapshotId: 'snapshot-current',
    });
    expect(provider).toHaveBeenCalledWith(
      'https://api.spotify.com/v1/playlists/selected?fields=id,name,owner(id,display_name),snapshot_id,tracks(total)',
      { headers: { Authorization: 'Bearer access-one' } },
    );
  });

  it('refreshes rejected authorization and retries rate limits as directed', async () => {
    const { api, spotify } = client();
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({}, { status: 429, headers: { 'Retry-After': '0' } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...((await fixture('playlists-page-2')) as object),
          limit: 50,
          offset: 0,
          total: 1,
        }),
      );

    await expect(api.getPlaylists()).resolves.toHaveLength(1);
    expect(spotify.refreshRejectedAccessToken).toHaveBeenCalledWith(
      'access-one',
    );
    expect(provider.mock.calls.map(([, init]) => init?.headers)).toEqual([
      { Authorization: 'Bearer access-one' },
      { Authorization: 'Bearer access-two' },
      { Authorization: 'Bearer access-two' },
    ]);
  });

  it('reports actionable authorization failure when a refreshed token is rejected', async () => {
    const { api } = client();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(Response.json({}, { status: 401 }));

    await expect(api.getPlaylists()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects malformed provider responses at the boundary', async () => {
    const { api } = client();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ items: 'not-an-array' }),
    );

    await expect(api.getPlaylists()).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it.each([
    {
      name: 'a terminal page before the declared total',
      itemCount: 1,
      page: { next: null, total: 2 },
    },
    {
      name: 'a response offset that does not match the request',
      itemCount: 1,
      page: { offset: 1, total: 1 },
    },
    {
      name: 'a non-contiguous next page',
      itemCount: 50,
      page: {
        next: 'https://api.spotify.com/v1/me/playlists?limit=50&offset=2',
        total: 51,
      },
    },
  ])('rejects $name', async ({ itemCount, page }) => {
    const { api } = client();
    const fixturePage = await fixture('playlists-page-2');
    const fixtureItem = (fixturePage as { items: unknown[] }).items[0];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json(
        Object.assign(
          {},
          fixturePage,
          { limit: 50, offset: 0, total: 1 },
          page,
          { items: Array.from({ length: itemCount }, () => fixtureItem) },
        ),
      ),
    );

    await expect(api.getPlaylists()).rejects.toThrow(
      /Spotify returned (incomplete|invalid) pagination/,
    );
  });

  it('does not retry a rate limit without Retry-After guidance', async () => {
    const { api } = client();
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({}, { status: 429 }));

    await expect(api.getPlaylists()).rejects.toThrow(
      'Spotify returned an invalid rate limit',
    );
    expect(provider).toHaveBeenCalledOnce();
  });
});
