import 'server-only';

import { spotifyConfigurationSchema } from '@playlarr/spotify-contracts';
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
