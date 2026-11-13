import { getImportWorkspaceContext } from '@playlarr/imports-web/server';
import { SpotifyImportedTracks } from '@playlarr/spotify-web';
import { getSpotifyImport } from '@playlarr/spotify-web/server';
import { TidalImportedTracks } from '@playlarr/tidal-web';
import { getTidalImport } from '@playlarr/tidal-web/server';
import { notFound } from 'next/navigation';

export default async function MusicMatchingPage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  const { importId } = await params;
  const context = await getImportWorkspaceContext(importId);

  if (context === null) notFound();

  if (context.source === 'Spotify') {
    const imported = await getSpotifyImport(importId);
    if (imported === null) notFound();
    return <SpotifyImportedTracks imported={imported} />;
  }

  const imported = await getTidalImport(importId);
  if (imported === null) notFound();
  return <TidalImportedTracks imported={imported} />;
}
