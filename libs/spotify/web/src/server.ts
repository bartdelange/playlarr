import 'server-only';

import {
  sourcePlaylistSchema,
  spotifyConfigurationSchema,
  spotifyImportSchema,
} from '@playlarr/spotify-contracts';
import { fetchNestApi } from '@playlarr/shared-web-infrastructure';
import { cookies } from 'next/headers';

export async function getSpotifyConfiguration() {
  const response = await fetchNestApi(
    '/spotify/configuration',
    (await cookies()).toString(),
  );
  if (!response.ok) throw new Error('Spotify configuration is unavailable');
  const parsed = spotifyConfigurationSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('Spotify configuration is invalid');
  return parsed.data;
}

export async function getSpotifyPlaylists() {
  const response = await fetchNestApi(
    '/spotify/playlists',
    (await cookies()).toString(),
  );
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Spotify playlists are unavailable');
  const parsed = sourcePlaylistSchema.array().safeParse(await response.json());
  if (!parsed.success) throw new Error('Spotify playlists are invalid');
  return parsed.data;
}

export async function getSpotifyImport(id: string) {
  const response = await fetchNestApi(
    `/spotify/imports/${encodeURIComponent(id)}`,
    (await cookies()).toString(),
  );
  if (!response.ok) throw new Error('Spotify import is unavailable');
  const parsed = spotifyImportSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('Spotify import is invalid');
  return parsed.data;
}
