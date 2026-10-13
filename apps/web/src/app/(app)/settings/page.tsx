import { AuthenticationSettings } from '@playlarr/auth-web';
import { SpotifySettings } from '@playlarr/spotify-web';
import { TidalSettings } from '@playlarr/tidal-web';

import { getAuthConfiguration } from '@playlarr/auth-web/server';
import { getSpotifyConfiguration } from '@playlarr/spotify-web/server';
import { getTidalConfiguration } from '@playlarr/tidal-web/server';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    spotify?: string;
    spotify_error?: string;
    tidal?: string;
    tidal_error?: string;
  }>;
}) {
  const [auth, spotify, tidal, query] = await Promise.all([
    getAuthConfiguration(),
    getSpotifyConfiguration(),
    getTidalConfiguration(),
    searchParams,
  ]);
  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <AuthenticationSettings initialConfiguration={auth} />
      <SpotifySettings
        initialConfiguration={spotify}
        authorizationResult={{
          status: query.spotify,
          error: query.spotify_error,
        }}
      />
      <TidalSettings
        initialConfiguration={tidal}
        authorizationResult={{
          status: query.tidal,
          error: query.tidal_error,
        }}
      />
    </div>
  );
}
