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
import { TidalImportUnavailable } from '@playlarr/tidal-web';

async function SpotifySource({
  authorizationResult,
}: {
  authorizationResult: { status?: string; error?: string };
}) {
  const configuration = await getSpotifyConfiguration();
  if (configuration.status !== 'connected') {
    return (
      <SpotifyAuthorizationRequired
        authorizationResult={authorizationResult}
        configured={configuration.status !== 'not_configured'}
      />
    );
  }
  const playlists = await getSpotifyPlaylists();
  if (!playlists)
    return (
      <SpotifyAuthorizationRequired
        authorizationResult={authorizationResult}
        configured
      />
    );
  return (
    <SpotifyPlaylistSelection
      authorizationResult={authorizationResult}
      playlists={playlists}
    />
  );
}

export default async function NewImportPage({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    spotify?: string;
    spotify_error?: string;
    tidal?: string;
    tidal_error?: string;
  }>;
}) {
  const {
    source,
    spotify,
    spotify_error: spotifyError,
    tidal,
    tidal_error: tidalError,
  } = await searchParams;
  if (source === undefined) return <NewImportSources />;
  if (source === 'tidal')
    return (
      <TidalImportUnavailable
        authorizationResult={{ status: tidal, error: tidalError }}
      />
    );
  if (source === 'spotify')
    return (
      <Suspense fallback={<p role="status">Loading Spotify playlists…</p>}>
        <SpotifySource
          authorizationResult={{ status: spotify, error: spotifyError }}
        />
      </Suspense>
    );
  return <NewImportSources />;
}
