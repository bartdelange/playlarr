import 'server-only';

import { getSpotifyImport } from '@playlarr/spotify-web/server';
import { getTidalImport } from '@playlarr/tidal-web/server';

export interface ImportWorkspaceContext {
  readonly id: string;
  readonly name: string;
  readonly source: 'Spotify' | 'TIDAL';
  readonly trackCount: number;
  readonly unavailableTrackCount: number;
}

export async function getImportWorkspaceContext(
  importId: string,
): Promise<ImportWorkspaceContext | null> {
  const [spotifyResult, tidalResult] = await Promise.allSettled([
    getSpotifyImport(importId),
    getTidalImport(importId),
  ]);
  const spotify =
    spotifyResult.status === 'fulfilled' ? spotifyResult.value : null;
  const tidal = tidalResult.status === 'fulfilled' ? tidalResult.value : null;
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
    name: imported.playlist.name,
    source: spotify === null ? 'TIDAL' : 'Spotify',
    trackCount: imported.tracks.length,
    unavailableTrackCount: imported.tracks.filter(
      (track) => track.status !== 'available',
    ).length,
  };
}
