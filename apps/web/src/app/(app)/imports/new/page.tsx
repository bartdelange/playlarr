import { Suspense } from 'react';
import {
  NewImportSources,
  SpotifyAuthorizationRequired,
  SpotifyPlaylistSelection,
} from '@playlarr/spotify-web';
import {
  getSpotifyConfiguration,
  getSpotifyPlaylists,
} from '@playlarr/spotify-web/server';

async function SpotifySource() {
  const configuration = await getSpotifyConfiguration();
  if (configuration.status !== 'connected') {
    return (
      <SpotifyAuthorizationRequired
        configured={configuration.status !== 'not_configured'}
      />
    );
  }
  const playlists = await getSpotifyPlaylists();
  if (!playlists) return <SpotifyAuthorizationRequired configured />;
  return <SpotifyPlaylistSelection playlists={playlists} />;
}

export default async function NewImportPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const { source } = await searchParams;
  if (source !== 'spotify') return <NewImportSources />;
  return (
    <Suspense fallback={<p role="status">Loading Spotify playlists…</p>}>
      <SpotifySource />
    </Suspense>
  );
}
