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
} from '@playlarr/spotify-contracts';
import { z } from 'zod';

import { SpotifyService } from './spotify.service.js';

const spotifyPlaylistSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    owner: z.object({
      id: z.string().min(1),
      display_name: z.string().nullable().default(null),
    }),
    snapshot_id: z.string(),
    tracks: z.object({ total: z.number().int().nonnegative() }).optional(),
    items: z.object({ total: z.number().int().nonnegative() }).optional(),
  })
  .refine((playlist) => playlist.items || playlist.tracks);

const spotifyTrackSchema = z.object({
  id: z.string().min(1).nullable(),
  name: z.string(),
  type: z.string(),
  is_local: z.boolean().default(false),
  artists: z.array(z.object({ name: z.string() })),
  album: z.object({ name: z.string() }),
  duration_ms: z.number().int().nonnegative(),
  disc_number: z.number().int().positive(),
  track_number: z.number().int().positive(),
});

const spotifyPlaylistItemSchema = z
  .object({
    is_local: z.boolean().default(false),
    item: z.unknown().optional(),
    track: z.unknown().optional(),
  })
  .transform(({ is_local, item, track }) => ({
    isLocal: is_local,
    value: item ?? track ?? null,
  }));
const spotifyItemTypeSchema = z.object({ type: z.string() });

function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    next: z.string().url().nullable(),
    total: z.number().int().nonnegative(),
  });
}

const playlistPageSchema = pageSchema(spotifyPlaylistSchema);
const playlistItemPageSchema = pageSchema(spotifyPlaylistItemSchema);
const pageLimit = 50;
const maxRateLimitRetries = 2;
const maxRetryAfterSeconds = 30;

@Injectable()
export class SpotifyApiClient {
  private readonly logger = new Logger(SpotifyApiClient.name);

  constructor(private readonly spotify: SpotifyService) {}

  async getPlaylists(): Promise<SourcePlaylist[]> {
    const playlists = await this.getAllPages(
      '/me/playlists',
      playlistPageSchema,
    );
    return playlists.map((playlist) => this.normalizePlaylist(playlist));
  }

  async getPlaylist(playlistId: string): Promise<SourcePlaylist> {
    const response = await this.request(
      `/playlists/${encodeURIComponent(playlistId)}?fields=id,name,owner(id,display_name),snapshot_id,tracks(total)`,
    );
    const parsed = spotifyPlaylistSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success)
      throw new BadGatewayException('Spotify returned an invalid playlist');
    return this.normalizePlaylist(parsed.data);
  }

  private normalizePlaylist(
    playlist: z.infer<typeof spotifyPlaylistSchema>,
  ): SourcePlaylist {
    return {
      id: playlist.id,
      name: playlist.name,
      owner: {
        id: playlist.owner.id,
        displayName: playlist.owner.display_name,
      },
      itemCount: playlist.items?.total ?? playlist.tracks?.total ?? 0,
      snapshotId: playlist.snapshot_id,
    };
  }

  async getPlaylistContents(
    playlistId: string,
  ): Promise<SourcePlaylistContents> {
    const items = await this.getAllPages(
      `/playlists/${encodeURIComponent(playlistId)}/items`,
      playlistItemPageSchema,
    );
    return {
      playlistId,
      tracks: items.map((item, position) =>
        this.normalizeTrack(item, position),
      ),
    };
  }

  private normalizeTrack(
    item: z.infer<typeof spotifyPlaylistItemSchema>,
    position: number,
  ): SourcePlaylistTrack {
    if (item.value === null) return { position, status: 'unavailable' };
    if (item.isLocal) return { position, status: 'local' };
    const itemType = spotifyItemTypeSchema.safeParse(item.value);
    if (!itemType.success)
      throw new BadGatewayException(
        'Spotify returned an invalid playlist item',
      );
    if (itemType.data.type !== 'track')
      return { position, status: 'unsupported' };
    const track = spotifyTrackSchema.safeParse(item.value);
    if (!track.success)
      throw new BadGatewayException('Spotify returned an invalid track');
    if (track.data.is_local) return { position, status: 'local' };
    if (track.data.id === null) return { position, status: 'unavailable' };
    return {
      position,
      status: 'available',
      sourceId: track.data.id,
      name: track.data.name,
      artists: track.data.artists.map(({ name }) => name),
      album: track.data.album.name,
      durationMs: track.data.duration_ms,
      discNumber: track.data.disc_number,
      trackNumber: track.data.track_number,
    };
  }

  private async getAllPages<T>(
    path: string,
    schema: z.ZodType<{
      items: T[];
      limit: number;
      offset: number;
      next: string | null;
      total: number;
    }>,
  ): Promise<T[]> {
    const items: T[] = [];
    let offset = 0;
    let total: number | undefined;
    while (true) {
      const separator = path.includes('?') ? '&' : '?';
      const response = await this.request(
        `${path}${separator}limit=${pageLimit}&offset=${offset}`,
      );
      const parsed = schema.safeParse(await response.json().catch(() => null));
      if (!parsed.success)
        throw new BadGatewayException('Spotify returned an invalid response');
      const page = parsed.data;
      total ??= page.total;
      const pageEnd = page.offset + page.items.length;
      if (
        page.offset !== offset ||
        page.limit !== pageLimit ||
        page.total !== total ||
        page.items.length > page.limit ||
        pageEnd > page.total
      )
        throw new BadGatewayException('Spotify returned invalid pagination');
      items.push(...page.items);
      if (page.next === null) {
        if (pageEnd !== page.total)
          throw new BadGatewayException(
            'Spotify returned incomplete pagination',
          );
        return items;
      }
      if (page.items.length !== page.limit || pageEnd >= page.total)
        throw new BadGatewayException('Spotify returned invalid pagination');
      offset = this.nextOffset(page.next, path, pageEnd);
    }
  }

  private nextOffset(next: string, path: string, expected: number): number {
    const url = new URL(next);
    const expectedUrl = new URL(`https://api.spotify.com/v1${path}`);
    const offset = url.searchParams.get('offset');
    const limit = url.searchParams.get('limit');
    if (
      url.origin !== expectedUrl.origin ||
      url.pathname !== expectedUrl.pathname ||
      offset === null ||
      !/^\d+$/.test(offset) ||
      Number(offset) !== expected ||
      limit === null ||
      !/^\d+$/.test(limit) ||
      Number(limit) !== pageLimit
    )
      throw new BadGatewayException('Spotify returned invalid pagination');
    return expected;
  }

  private async request(path: string): Promise<Response> {
    let accessToken = await this.spotify.getAccessToken();
    let refreshed = false;
    let rateLimitRetries = 0;
    while (true) {
      const response = await fetch(`https://api.spotify.com/v1${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response.status === 401 && !refreshed) {
        accessToken =
          await this.spotify.refreshRejectedAccessToken(accessToken);
        refreshed = true;
        continue;
      }
      if (response.status === 401)
        throw new UnauthorizedException(
          'Spotify authorization is no longer valid',
        );
      if (response.status === 429 && rateLimitRetries < maxRateLimitRetries) {
        const retryAfter = this.retryAfterSeconds(response);
        rateLimitRetries += 1;
        this.logger.debug(
          `Spotify rate limited a request; retrying in ${retryAfter} seconds`,
        );
        await delay(retryAfter * 1_000);
        continue;
      }
      if (!response.ok)
        throw new BadGatewayException(
          'Spotify playlist service is unavailable',
        );
      return response;
    }
  }

  private retryAfterSeconds(response: Response): number {
    const header = response.headers.get('Retry-After');
    if (header === null || !/^\d+$/.test(header))
      throw new BadGatewayException('Spotify returned an invalid rate limit');
    const value = Number(header);
    if (!Number.isSafeInteger(value))
      throw new BadGatewayException('Spotify returned an invalid rate limit');
    return Math.min(value, maxRetryAfterSeconds);
  }
}
