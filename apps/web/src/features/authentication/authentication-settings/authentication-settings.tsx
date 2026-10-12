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
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/auth/configuration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          username: form.get('username'),
          password: form.get('password') || undefined,
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

      const username = String(form.get('username'));

      setConfiguration({ enabled, username });
      setSaved(true);
      router.refresh();
    } catch {
      setError('Unable to save authentication settings. Please try again.');
    } finally {
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

        <span className={enabled ? styles.enabled : styles.disabled}>
          {enabled ? 'Enabled' : 'Disabled'}
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
          defaultValue={initialConfiguration.username}
          id="auth-username"
          maxLength={128}
          name="username"
          required
          type="text"
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
          required={enabled && !configuration.enabled}
          type="password"
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
