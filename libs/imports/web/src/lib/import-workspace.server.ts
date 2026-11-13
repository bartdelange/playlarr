import 'server-only';

import { cache } from 'react';
import { getSpotifyImports } from '@playlarr/spotify-web/server';
import { getTidalImports } from '@playlarr/tidal-web/server';

export interface ImportWorkspaceContext {
  readonly id: string;
  readonly name: string;
  readonly source: 'Spotify' | 'TIDAL';
  readonly trackCount: number;
  readonly unavailableTrackCount: number;
}

async function loadImportWorkspaceContext(
  importId: string,
): Promise<ImportWorkspaceContext | null> {
  const [spotifyResult, tidalResult] = await Promise.allSettled([
    getSpotifyImports(),
    getTidalImports(),
  ]);
  const spotify =
    spotifyResult.status === 'fulfilled'
      ? (spotifyResult.value.find((imported) => imported.id === importId) ??
        null)
      : null;
  const tidal =
    tidalResult.status === 'fulfilled'
      ? (tidalResult.value.find((imported) => imported.id === importId) ?? null)
      : null;

  // Provider repositories generate UUIDv4 import IDs. Canonical import URLs
  // therefore treat the ID as globally unique across provider stores.
  const imported = spotify ?? tidal;

  if (imported === null) {
    if (
      spotifyResult.status === 'rejected' ||
      tidalResult.status === 'rejected'
    ) {
      throw new Error('Import workspace is unavailable');
    }

    return null;
  }

  return {
    id: imported.id,
    name: imported.name,
    source: spotify === null ? 'TIDAL' : 'Spotify',
    trackCount: imported.trackCount,
    unavailableTrackCount: imported.unavailableTrackCount,
  };
}

export const getImportWorkspaceContext = cache(loadImportWorkspaceContext);
