'use client';

import { useState, type FormEvent } from 'react';
import {
  spotifyConfigurationSchema,
  type SpotifyConfiguration,
} from '@playlarr/spotify-contracts';

import styles from './spotify-settings.module.css';

const statusLabels = {
  not_configured: 'Not configured',
  not_connected: 'Not connected',
  connected: 'Connected',
  reconnect_required: 'Reconnect required',
} as const;

const authorizationErrorMessages: Record<string, string> = {
  access_denied: 'Spotify authorization was cancelled.',
  configuration_changed:
    'Spotify settings changed during authorization. Start authorization again.',
  missing_code: 'Spotify did not return an authorization code.',
  provider_error: 'Spotify could not complete authorization.',
};

export function SpotifySettings({
  initialConfiguration,
  authorizationResult,
}: {
  initialConfiguration: SpotifyConfiguration;
  authorizationResult?: { status?: string; error?: string };
}) {
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const [clientId, setClientId] = useState(initialConfiguration.clientId);
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState(
    initialConfiguration.redirectUri,
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      const response = await fetch('/api/spotify/configuration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          redirectUri,
          clientSecret: clientSecret || undefined,
        }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(
          typeof body === 'object' &&
            body !== null &&
            'message' in body &&
            typeof body.message === 'string'
            ? body.message
            : 'Unable to save Spotify settings. Please try again.',
        );
        return;
      }
      const parsed = spotifyConfigurationSchema.safeParse(
        await response.json(),
      );
      if (!parsed.success) {
        setError('Spotify settings returned an invalid response.');
        return;
      }
      setConfiguration(parsed.data);
      setClientSecret('');
      setSaved(true);
    } catch {
      setError('Unable to save Spotify settings. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const status = configuration.status;
  return (
    <section aria-labelledby="spotify-heading" className={styles.card}>
      <div className={styles.heading}>
        <div>
          <h2 id="spotify-heading">Spotify</h2>
          <p>Connect a Spotify application to import your playlists.</p>
        </div>
        <span
          className={
            status === 'connected'
              ? styles.connected
              : status === 'reconnect_required'
                ? styles.problem
                : styles.inactive
          }
        >
          {statusLabels[status]}
        </span>
      </div>

      {configuration.account ? (
        <p className={styles.account}>
          {status === 'reconnect_required'
            ? 'Previously connected as '
            : 'Connected as '}
          {configuration.account.displayName ?? configuration.account.id}.
        </p>
      ) : null}
      {authorizationResult?.status === 'connected' ? (
        <p className={styles.success}>Spotify connected successfully.</p>
      ) : null}
      {authorizationResult?.status === 'error' ? (
        <p className={styles.error} role="alert">
          {authorizationErrorMessages[
            authorizationResult.error ?? 'provider_error'
          ] ?? authorizationErrorMessages.provider_error}{' '}
          Check the app settings and reconnect.
        </p>
      ) : null}
      {status === 'reconnect_required' ? (
        <p className={styles.error} role="alert">
          Spotify no longer accepts the saved authorization. Reconnect to
          continue.
        </p>
      ) : null}

      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <label htmlFor="spotify-client-id">Client ID</label>
        <input
          id="spotify-client-id"
          maxLength={256}
          required
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
        />
        <label htmlFor="spotify-client-secret">
          {configuration.clientSecretConfigured
            ? 'New client secret'
            : 'Client secret'}
        </label>
        <input
          autoComplete="new-password"
          id="spotify-client-secret"
          maxLength={1024}
          required={!configuration.clientSecretConfigured}
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
        />
        <p className={styles.help}>
          Saved secrets stay on the server. Leave this blank to keep the current
          secret.
        </p>
        <label htmlFor="spotify-redirect-uri">Redirect URI</label>
        <input
          id="spotify-redirect-uri"
          maxLength={2048}
          required
          type="url"
          value={redirectUri}
          onChange={(event) => setRedirectUri(event.target.value)}
        />
        <p className={styles.help}>
          Add this exact URI to your Spotify app. Use HTTPS, or an explicit
          loopback IP for local development.
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className={styles.success}>
            Spotify settings saved. Authorize the app to connect.
          </p>
        ) : null}
        <div className={styles.actions}>
          <button disabled={submitting} type="submit">
            {submitting ? 'Saving…' : 'Save Spotify settings'}
          </button>
          {configuration.status !== 'not_configured' ? (
            <a href="/api/spotify/authorize?returnTo=%2Fsettings">
              {status === 'connected'
                ? 'Reconnect Spotify'
                : 'Authorize Spotify'}
            </a>
          ) : null}
        </div>
      </form>
    </section>
  );
}
