import { Suspense } from 'react';
import {
  SpotifyAuthorizationRequired,
  SpotifyPlaylistSelection,
} from '@playlarr/spotify-web';
import {
  getSpotifyConfiguration,
  getSpotifyPlaylists,
} from '@playlarr/spotify-web/server';
import { TidalImportUnavailable } from '@playlarr/tidal-web';

import { NewImportSources } from './new-import-sources.js';

export interface NewImportSearchParams {
  source?: string;
  spotify?: string;
  spotify_error?: string;
  tidal?: string;
  tidal_error?: string;
}

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
  if (!playlists) {
    return (
      <SpotifyAuthorizationRequired
        authorizationResult={authorizationResult}
        configured
      />
    );
  }
  return (
    <SpotifyPlaylistSelection
      authorizationResult={authorizationResult}
      playlists={playlists}
    />
  );
}

export function NewImport({
  searchParams,
}: {
  searchParams: NewImportSearchParams;
}) {
  const {
    source,
    spotify,
    spotify_error: spotifyError,
    tidal,
    tidal_error: tidalError,
  } = searchParams;

  if (source === 'spotify') {
    return (
      <Suspense fallback={<p role="status">Loading Spotify playlists…</p>}>
        <SpotifySource
          authorizationResult={{ status: spotify, error: spotifyError }}
        />
      </Suspense>
    );
  }
  if (source === 'tidal') {
    return (
      <TidalImportUnavailable
        authorizationResult={{ status: tidal, error: tidalError }}
      />
    );
  }
  return <NewImportSources />;
}
