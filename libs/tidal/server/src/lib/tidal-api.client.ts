import { setTimeout as delay } from 'node:timers/promises';

import {
  BadGatewayException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  SourcePlaylist,
  SourcePlaylistContents,
  SourcePlaylistTrack,
} from '@playlarr/tidal-contracts';
import { z } from 'zod';

import { TidalService } from './tidal.service.js';

const resourceIdentifierSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
});
const relationshipSchema = z.object({
  data: z.array(resourceIdentifierSchema).optional(),
});
const playlistSchema = z.object({
  id: z.string().min(1),
  type: z.literal('playlists'),
  attributes: z.object({
    name: z.string(),
    numberOfItems: z.number().int().nonnegative().optional(),
    lastModifiedAt: z.iso.datetime(),
  }),
  relationships: z.object({ owners: relationshipSchema }),
});
const userSchema = z.object({
  id: z.string().min(1),
  type: z.literal('users'),
  attributes: z.object({ username: z.string() }),
});
const albumSchema = z.object({
  id: z.string().min(1),
  type: z.literal('albums'),
  attributes: z.object({ title: z.string() }),
});
const artistSchema = z.object({
  id: z.string().min(1),
  type: z.literal('artists'),
  attributes: z.object({ name: z.string() }),
});
const videoSchema = z.object({
  id: z.string().min(1),
  type: z.literal('videos'),
});
const trackSchema = z.object({
  id: z.string().min(1),
  type: z.literal('tracks'),
  attributes: z.object({
    title: z.string(),
    duration: z
      .string()
      .regex(/^PT(?=\d|.*[HMS])(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?$/),
  }),
  relationships: z.object({
    albums: relationshipSchema,
    artists: relationshipSchema,
  }),
});
const includedResourceSchema = z.union([
  userSchema,
  albumSchema,
  artistSchema,
  trackSchema,
  videoSchema,
]);
const linksSchema = z.object({
  self: z.string(),
  next: z.string().optional(),
});
const playlistPageSchema = z.object({
  data: z.array(playlistSchema),
  included: z.array(includedResourceSchema).default([]),
  links: linksSchema,
});
const playlistItemsPageSchema = z.object({
  data: z.array(resourceIdentifierSchema).default([]),
  included: z.array(includedResourceSchema).default([]),
  links: linksSchema,
});

type IncludedResource = z.infer<typeof includedResourceSchema>;
type Track = z.infer<typeof trackSchema>;

const apiOrigin = 'https://openapi.tidal.com';
const apiBasePath = '/v2';
const maxRateLimitRetries = 2;
const maxRetryAfterSeconds = 30;

@Injectable()
export class TidalApiClient {
  private readonly logger = new Logger(TidalApiClient.name);

  constructor(private readonly tidal: TidalService) {}

  async getPlaylists(): Promise<SourcePlaylist[]> {
    const pages = await this.getAllPages(
      '/playlists?filter[owners.id]=me&include=owners',
      playlistPageSchema,
    );
    return pages.flatMap(({ data, included }) => {
      const resources = this.resourceMap(included);
      return data.map((playlist) => {
        const owner = playlist.relationships.owners.data?.[0];
        if (!owner || owner.type !== 'users')
          throw new BadGatewayException(
            'TIDAL returned a playlist without an owner',
          );
        const profile = resources.get(this.resourceKey(owner));
        if (!profile || profile.type !== 'users')
          throw new BadGatewayException('TIDAL returned an invalid owner');
        return {
          id: playlist.id,
          name: playlist.attributes.name,
          owner: { id: owner.id, displayName: profile.attributes.username },
          itemCount: playlist.attributes.numberOfItems ?? 0,
          snapshotId: playlist.attributes.lastModifiedAt,
        };
      });
    });
  }

  async getPlaylistContents(
    playlistId: string,
  ): Promise<SourcePlaylistContents> {
    const pages = await this.getAllPages(
      `/playlists/${encodeURIComponent(playlistId)}/relationships/items?include=items.artists,items.albums`,
      playlistItemsPageSchema,
    );
    const tracks: SourcePlaylistTrack[] = [];
    for (const page of pages) {
      const resources = this.resourceMap(page.included);
      for (const item of page.data)
        tracks.push(this.normalizeItem(item, resources, tracks.length));
    }
    return { playlistId, tracks };
  }

  private normalizeItem(
    item: z.infer<typeof resourceIdentifierSchema>,
    resources: Map<string, IncludedResource>,
    position: number,
  ): SourcePlaylistTrack {
    if (item.type !== 'tracks') return { position, status: 'unsupported' };
    const resource = resources.get(this.resourceKey(item));
    if (!resource) return { position, status: 'unavailable' };
    if (resource.type !== 'tracks')
      throw new BadGatewayException('TIDAL returned an invalid playlist item');
    return this.normalizeTrack(resource, resources, position);
  }

  private normalizeTrack(
    track: Track,
    resources: Map<string, IncludedResource>,
    position: number,
  ): SourcePlaylistTrack {
    const albums = track.relationships.albums.data ?? [];
    const artists = track.relationships.artists.data ?? [];
    const album = albums[0] && resources.get(this.resourceKey(albums[0]));
    const artistResources = artists.map((artist) =>
      resources.get(this.resourceKey(artist)),
    );
    if (
      !album ||
      album.type !== 'albums' ||
      artistResources.some((artist) => !artist || artist.type !== 'artists')
    )
      throw new BadGatewayException('TIDAL returned incomplete track metadata');
    return {
      position,
      status: 'available',
      sourceId: track.id,
      name: track.attributes.title,
      artists: artistResources.map((artist) =>
        artist && artist.type === 'artists' ? artist.attributes.name : '',
      ),
      album: album.attributes.title,
      durationMs: this.durationMs(track.attributes.duration),
      discNumber: null,
      trackNumber: null,
    };
  }

  private async getAllPages<T>(
    path: string,
    schema: z.ZodType<T & { links: { self: string; next?: string } }>,
  ): Promise<(T & { links: { self: string; next?: string } })[]> {
    const pages: (T & { links: { self: string; next?: string } })[] = [];
    let next: string | undefined = path;
    const expectedPathname = new URL(`${apiOrigin}${apiBasePath}${path}`)
      .pathname;
    const visited = new Set<string>();
    while (next) {
      if (visited.has(next))
        throw new BadGatewayException('TIDAL returned cyclic pagination');
      visited.add(next);
      const response = await this.request(next);
      const parsed = schema.safeParse(await response.json().catch(() => null));
      if (!parsed.success)
        throw new BadGatewayException('TIDAL returned an invalid response');
      pages.push(parsed.data);
      next = parsed.data.links.next
        ? this.validateNextLink(parsed.data.links.next, expectedPathname)
        : undefined;
    }
    return pages;
  }

  private validateNextLink(next: string, expectedPathname: string): string {
    const url = new URL(next, apiOrigin);
    if (url.origin !== apiOrigin || url.pathname !== expectedPathname)
      throw new BadGatewayException('TIDAL returned invalid pagination');
    return `${url.pathname.slice(apiBasePath.length)}${url.search}`;
  }

  private resourceMap(resources: IncludedResource[]) {
    const map = new Map<string, IncludedResource>();
    for (const resource of resources) {
      const key = this.resourceKey(resource);
      if (map.has(key))
        throw new BadGatewayException('TIDAL returned duplicate resources');
      map.set(key, resource);
    }
    return map;
  }

  private resourceKey(resource: { id: string; type: string }) {
    return `${resource.type}:${resource.id}`;
  }

  private durationMs(duration: string): number {
    const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(
      duration,
    );
    if (!match)
      throw new BadGatewayException('TIDAL returned an invalid track duration');
    return Math.round(
      (Number(match[1] ?? 0) * 3600 +
        Number(match[2] ?? 0) * 60 +
        Number(match[3] ?? 0)) *
        1000,
    );
  }

  private async request(path: string): Promise<Response> {
    let accessToken = await this.tidal.getAccessToken();
    let refreshed = false;
    let rateLimitRetries = 0;
    while (true) {
      const response = await fetch(`${apiOrigin}${apiBasePath}${path}`, {
        headers: {
          Accept: 'application/vnd.api+json',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (response.status === 401 && !refreshed) {
        accessToken = await this.tidal.refreshRejectedAccessToken(accessToken);
        refreshed = true;
        continue;
      }
      if (response.status === 401)
        throw new UnauthorizedException(
          'TIDAL authorization is no longer valid',
        );
      if (response.status === 429 && rateLimitRetries < maxRateLimitRetries) {
        const retryAfter = this.retryAfterSeconds(response);
        rateLimitRetries += 1;
        this.logger.debug(
          `TIDAL rate limited a request; retrying in ${retryAfter} seconds`,
        );
        await delay(retryAfter * 1_000);
        continue;
      }
      if (!response.ok)
        throw new BadGatewayException('TIDAL playlist service is unavailable');
      return response;
    }
  }

  private retryAfterSeconds(response: Response): number {
    const header = response.headers.get('Retry-After');
    if (header === null || !/^\d+$/.test(header))
      throw new BadGatewayException('TIDAL returned an invalid rate limit');
    const value = Number(header);
    if (!Number.isSafeInteger(value))
      throw new BadGatewayException('TIDAL returned an invalid rate limit');
    return Math.min(value, maxRetryAfterSeconds);
  }
}
