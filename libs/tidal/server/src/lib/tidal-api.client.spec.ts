import { readFile } from 'node:fs/promises';

import { BadGatewayException, UnauthorizedException } from '@nestjs/common';

import { TidalApiClient } from './tidal-api.client.js';
import type { TidalService } from './tidal.service.js';

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'),
  );
}

function client() {
  const tidal = {
    getAccessToken: vi.fn().mockResolvedValue('access-one'),
    refreshRejectedAccessToken: vi.fn().mockResolvedValue('access-two'),
  };
  return {
    api: new TidalApiClient(tidal as unknown as TidalService),
    tidal,
  };
}

describe('TidalApiClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('discovers and normalizes every page of the authenticated user playlists', async () => {
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
        snapshotId: '2026-10-01T12:00:00Z',
      },
      {
        id: 'playlist-two',
        name: 'Second playlist',
        owner: { id: 'owner-two', displayName: 'Other listener' },
        itemCount: 2,
        snapshotId: '2026-10-02T12:00:00Z',
      },
    ]);
    expect(provider.mock.calls.map(([url]) => String(url))).toEqual([
      'https://openapi.tidal.com/v2/playlists?filter[owners.id]=me&include=owners',
      'https://openapi.tidal.com/v2/playlists?filter[owners.id]=me&include=owners&page[cursor]=next',
    ]);
  });

  it('preserves exact item order and duplicates with deterministic unusual-item rules', async () => {
    const { api } = client();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json(await fixture('playlist-items-page-1')),
      )
      .mockResolvedValueOnce(
        Response.json(await fixture('playlist-items-page-2')),
      );

    await expect(api.getPlaylistContents('selected')).resolves.toEqual({
      playlistId: 'selected',
      tracks: [
        {
          position: 0,
          status: 'available',
          sourceId: 'track-one',
          name: 'Repeated song',
          artists: ['Artist one', 'Artist two'],
          album: 'Album one',
          durationMs: 123456,
          discNumber: null,
          trackNumber: null,
        },
        {
          position: 1,
          status: 'available',
          sourceId: 'track-one',
          name: 'Repeated song',
          artists: ['Artist one', 'Artist two'],
          album: 'Album one',
          durationMs: 123456,
          discNumber: null,
          trackNumber: null,
        },
        { position: 2, status: 'unavailable' },
        { position: 3, status: 'unsupported' },
        {
          position: 4,
          status: 'available',
          sourceId: 'track-two',
          name: 'Another song',
          artists: ['Artist two'],
          album: 'Album two',
          durationMs: 3661000,
          discNumber: null,
          trackNumber: null,
        },
      ],
    });
  });

  it('refreshes rejected authorization and retries guided rate limits', async () => {
    const { api, tidal } = client();
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({}, { status: 429, headers: { 'Retry-After': '0' } }),
      )
      .mockResolvedValueOnce(Response.json(await fixture('playlists-page-2')));

    await expect(api.getPlaylists()).resolves.toHaveLength(1);
    expect(tidal.refreshRejectedAccessToken).toHaveBeenCalledWith('access-one');
    expect(provider.mock.calls.map(([, init]) => init?.headers)).toEqual([
      {
        Accept: 'application/vnd.api+json',
        Authorization: 'Bearer access-one',
      },
      {
        Accept: 'application/vnd.api+json',
        Authorization: 'Bearer access-two',
      },
      {
        Accept: 'application/vnd.api+json',
        Authorization: 'Bearer access-two',
      },
    ]);
  });

  it('reports an actionable failure when refreshed authorization is rejected', async () => {
    const { api } = client();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(Response.json({}, { status: 401 }));

    await expect(api.getPlaylists()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([
    ['malformed payloads', { data: 'not-an-array' }],
    [
      'playlists without an item count',
      {
        data: [
          {
            id: 'playlist-one',
            type: 'playlists',
            attributes: {
              name: 'Unknown size',
              lastModifiedAt: '2026-10-01T12:00:00Z',
            },
            relationships: {
              owners: { data: [{ id: 'owner-one', type: 'users' }] },
            },
          },
        ],
        links: { self: '/v2/playlists' },
      },
    ],
    [
      'pagination outside TIDAL',
      {
        data: [],
        links: {
          self: '/v2/playlists',
          next: 'https://example.com/v2/playlists?page[cursor]=stolen',
        },
      },
    ],
  ])('rejects %s at the provider boundary', async (_name, response) => {
    const { api } = client();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json(response),
    );

    await expect(api.getPlaylists()).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('reports a malformed pagination URL as a provider failure', async () => {
    const { api } = client();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        data: [],
        links: { self: '/v2/playlists', next: 'http://[' },
      }),
    );

    await expect(api.getPlaylists()).rejects.toMatchObject({
      status: 502,
      message: 'TIDAL returned invalid pagination',
    });
  });

  it('does not retry a rate limit without Retry-After guidance', async () => {
    const { api } = client();
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({}, { status: 429 }));

    await expect(api.getPlaylists()).rejects.toThrow(
      'TIDAL returned an invalid rate limit',
    );
    expect(provider).toHaveBeenCalledOnce();
  });
});
