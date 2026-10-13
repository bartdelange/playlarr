'use client';

import { useState, type FormEvent } from 'react';
import {
  tidalConfigurationSchema,
  type TidalConfiguration,
} from '@playlarr/tidal-contracts';

import styles from './tidal-settings.module.css';

const statusLabels = {
  not_configured: 'Not configured',
  not_connected: 'Not connected',
  connected: 'Connected',
  reconnect_required: 'Reconnect required',
} as const;

const authorizationErrorMessages: Record<string, string> = {
  access_denied: 'TIDAL authorization was cancelled.',
  configuration_changed:
    'TIDAL settings changed during authorization. Start authorization again.',
  missing_code: 'TIDAL did not return an authorization code.',
  provider_error: 'TIDAL could not complete authorization.',
};

export function TidalSettings({
  initialConfiguration,
  authorizationResult,
}: {
  initialConfiguration: TidalConfiguration;
  authorizationResult?: { status?: string; error?: string };
}) {
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const [clientId, setClientId] = useState(initialConfiguration.clientId);
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
      const response = await fetch('/api/tidal/configuration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, redirectUri }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(
          typeof body === 'object' &&
            body !== null &&
            'message' in body &&
            typeof body.message === 'string'
            ? body.message
            : 'Unable to save TIDAL settings. Please try again.',
        );
        return;
      }
      const parsed = tidalConfigurationSchema.safeParse(await response.json());
      if (!parsed.success) {
        setError('TIDAL settings returned an invalid response.');
        return;
      }
      setConfiguration(parsed.data);
      setSaved(true);
    } catch {
      setError('Unable to save TIDAL settings. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const status = configuration.status;
  return (
    <section aria-labelledby="tidal-heading" className={styles.card}>
      <div className={styles.heading}>
        <div>
          <h2 id="tidal-heading">TIDAL</h2>
          <p>Connect a TIDAL application to access your playlists.</p>
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
          {configuration.account.id}.
        </p>
      ) : null}
      {authorizationResult?.status === 'connected' ? (
        <p className={styles.success}>TIDAL connected successfully.</p>
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
          TIDAL no longer accepts the saved authorization. Reconnect to
          continue.
        </p>
      ) : null}

      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <label htmlFor="tidal-client-id">Client ID</label>
        <input
          id="tidal-client-id"
          maxLength={256}
          required
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
        />
        <label htmlFor="tidal-redirect-uri">Redirect URI</label>
        <input
          id="tidal-redirect-uri"
          maxLength={2048}
          required
          type="url"
          value={redirectUri}
          onChange={(event) => setRedirectUri(event.target.value)}
        />
        <p className={styles.help}>
          Add this exact URI to your TIDAL app. Use HTTPS, or an explicit
          loopback IP for local development.
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className={styles.success}>
            TIDAL settings saved. Authorize the app to connect.
          </p>
        ) : null}
        <div className={styles.actions}>
          <button disabled={submitting} type="submit">
            {submitting ? 'Saving…' : 'Save TIDAL settings'}
          </button>
          {configuration.status !== 'not_configured' ? (
            <a href="/api/tidal/authorize?returnTo=%2Fsettings">
              {status === 'connected' ? 'Reconnect TIDAL' : 'Authorize TIDAL'}
            </a>
          ) : null}
        </div>
      </form>
    </section>
  );
}
