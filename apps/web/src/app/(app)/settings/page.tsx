import { AuthenticationSettings } from '@playlarr/auth-web';
import { SpotifySettings } from '@playlarr/spotify-web';

import { getAuthConfiguration } from '@playlarr/auth-web/server';
import { getSpotifyConfiguration } from '@playlarr/spotify-web/server';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ spotify?: string; spotify_error?: string }>;
}) {
  const [auth, spotify, query] = await Promise.all([
    getAuthConfiguration(),
    getSpotifyConfiguration(),
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
    </div>
  );
}
