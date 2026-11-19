import 'server-only';

import { fetchNestApi } from '@playlarr/shared-web-infrastructure';
import {
  importSummarySchema,
  sourcePlaylistSchema,
  tidalConfigurationSchema,
  tidalImportSchema,
} from '@playlarr/tidal-contracts';
import { cookies } from 'next/headers';

export async function getTidalConfiguration() {
  const response = await fetchNestApi(
    '/tidal/configuration',
    (await cookies()).toString(),
  );
  if (!response.ok) throw new Error('TIDAL configuration is unavailable');
  const parsed = tidalConfigurationSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('TIDAL configuration is invalid');
  return parsed.data;
}

export async function getTidalPlaylists() {
  const response = await fetchNestApi(
    '/tidal/playlists',
    (await cookies()).toString(),
  );
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('TIDAL playlists are unavailable');
  const parsed = sourcePlaylistSchema.array().safeParse(await response.json());
  if (!parsed.success) throw new Error('TIDAL playlists are invalid');
  return parsed.data;
}

export async function getTidalImport(id: string) {
  const response = await fetchNestApi(
    `/tidal/imports/${encodeURIComponent(id)}`,
    (await cookies()).toString(),
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('TIDAL import is unavailable');
  const parsed = tidalImportSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('TIDAL import is invalid');
  return parsed.data;
}

export async function getTidalImports() {
  const response = await fetchNestApi(
    '/tidal/imports',
    (await cookies()).toString(),
  );
  if (!response.ok) throw new Error('TIDAL imports are unavailable');
  const parsed = importSummarySchema.array().safeParse(await response.json());
  if (!parsed.success) throw new Error('TIDAL imports are invalid');
  return parsed.data;
}
