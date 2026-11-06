import { SpotifyImportWorkspace } from '@playlarr/spotify-web';
import { getSpotifyImport } from '@playlarr/spotify-web/server';
import { TidalImportWorkspace } from '@playlarr/tidal-web';
import { getTidalImport } from '@playlarr/tidal-web/server';

export default async function ImportWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ importId: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { importId } = await params;
  if ((await searchParams).source === 'tidal')
    return <TidalImportWorkspace imported={await getTidalImport(importId)} />;
  return <SpotifyImportWorkspace imported={await getSpotifyImport(importId)} />;
}
