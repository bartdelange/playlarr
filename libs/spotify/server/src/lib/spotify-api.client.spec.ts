import { readFile } from 'node:fs/promises';

import { BadGatewayException } from '@nestjs/common';

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
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(await fixture('playlists-page-1')))
      .mockResolvedValueOnce(Response.json(await fixture('playlists-page-2')));

    await expect(api.getPlaylists()).resolves.toEqual([
      {
        id: 'playlist-one',
        name: 'First playlist',
        owner: { id: 'owner-one', displayName: 'Listener' },
        itemCount: 5,
        snapshotId: 'snapshot-one',
      },
      {
        id: 'playlist-two',
        name: 'Second playlist',
        owner: { id: 'owner-two', displayName: null },
        itemCount: 2,
        snapshotId: 'snapshot-two',
      },
    ]);
    expect(provider.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.spotify.com/v1/me/playlists?limit=50&offset=0',
      'https://api.spotify.com/v1/me/playlists?limit=50&offset=1',
    ]);
  });

  it('preserves source order and duplicates while classifying non-standard items', async () => {
    const { api } = client();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json(await fixture('playlist-items-page-1')),
      )
      .mockResolvedValueOnce(
        Response.json(await fixture('playlist-items-page-2')),
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

  it('refreshes rejected authorization and retries rate limits as directed', async () => {
    const { api, spotify } = client();
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({}, { status: 429, headers: { 'Retry-After': '0' } }),
      )
      .mockResolvedValueOnce(Response.json(await fixture('playlists-page-2')));

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

  it('rejects malformed provider responses at the boundary', async () => {
    const { api } = client();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ items: 'not-an-array' }),
    );

    await expect(api.getPlaylists()).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
