'use client';

import { useState, type FormEvent } from 'react';

import styles from '../login.module.css';

export function LoginForm({ destination }: { destination: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.get('username'),
          password: form.get('password'),
        }),
      });

      if (response.status === 401) {
        setError('Invalid username or password.');
        return;
      }

      if (!response.ok) {
        setError('Unable to log in. Please try again.');
        return;
      }

      window.location.assign(destination);
    } catch {
      setError('Unable to log in. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <label htmlFor="username">Username</label>
      <input
        autoComplete="username"
        id="username"
        name="username"
        required
        type="text"
      />

      <label htmlFor="password">Password</label>
      <input
        autoComplete="current-password"
        id="password"
        name="password"
        required
        type="password"
      />

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <button disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
