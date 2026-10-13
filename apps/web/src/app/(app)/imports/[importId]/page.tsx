import { SpotifyImportWorkspace } from '@playlarr/spotify-web';
import { getSpotifyImport } from '@playlarr/spotify-web/server';

export default async function ImportWorkspacePage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  const { importId } = await params;
  return <SpotifyImportWorkspace imported={await getSpotifyImport(importId)} />;
}
