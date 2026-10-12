'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import styles from './authentication-settings.module.css';

export interface AuthConfiguration {
  enabled: boolean;
  username: string;
}

export function AuthenticationSettings({
  initialConfiguration,
}: {
  initialConfiguration: AuthConfiguration;
}) {
  const router = useRouter();
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const [enabled, setEnabled] = useState(initialConfiguration.enabled);
  const [username, setUsername] = useState(initialConfiguration.username);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/configuration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          username,
          password: password || undefined,
        }),
      });

      if (response.status === 400) {
        const body = (await response.json()) as { message?: unknown };
        setError(
          typeof body.message === 'string'
            ? body.message
            : 'Check the authentication settings and try again.',
        );
        return;
      }

      if (!response.ok) {
        setError('Unable to save authentication settings. Please try again.');
        return;
      }

      const savedConfiguration: unknown = await response.json();

      if (
        typeof savedConfiguration !== 'object' ||
        savedConfiguration === null ||
        !('enabled' in savedConfiguration) ||
        typeof savedConfiguration.enabled !== 'boolean' ||
        !('username' in savedConfiguration) ||
        typeof savedConfiguration.username !== 'string'
      ) {
        setError('Authentication settings returned an invalid response.');
        return;
      }

      setConfiguration(savedConfiguration as AuthConfiguration);
      setEnabled(savedConfiguration.enabled);
      setUsername(savedConfiguration.username);
      setSaved(true);
      router.refresh();
    } catch {
      setError('Unable to save authentication settings. Please try again.');
    } finally {
      setPassword('');
      setIsSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="authentication-heading" className={styles.card}>
      <div className={styles.heading}>
        <div>
          <h2 id="authentication-heading">Authentication</h2>
          <p>
            Require a username and password before users can access Playlarr.
          </p>
        </div>

        <span
          className={configuration.enabled ? styles.enabled : styles.disabled}
        >
          {configuration.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <label className={styles.toggle}>
          <input
            checked={enabled}
            name="enabled"
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          Enable authentication
        </label>

        <label htmlFor="auth-username">Username</label>
        <input
          autoComplete="username"
          id="auth-username"
          maxLength={128}
          name="username"
          onChange={(event) => setUsername(event.target.value)}
          required
          type="text"
          value={username}
        />

        <label htmlFor="auth-password">
          {configuration.enabled ? 'New password' : 'Password'}
        </label>
        <input
          aria-describedby="password-help"
          autoComplete="new-password"
          id="auth-password"
          maxLength={1024}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required={enabled && !configuration.enabled}
          type="password"
          value={password}
        />
        <p className={styles.help} id="password-help">
          {configuration.enabled
            ? 'Leave blank to keep the current password.'
            : 'A password is required when enabling authentication.'}
        </p>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {saved ? (
          <p className={styles.success} role="status">
            Authentication settings saved.
          </p>
        ) : null}

        <button disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Saving…' : 'Save authentication settings'}
        </button>
      </form>
    </section>
  );
}
