'use client';

import { useEffect, useState, type ReactNode } from 'react';

import styles from './authenticated-shell.module.css';

export function AuthenticatedShell({
  children,
  showLogout,
}: {
  children: ReactNode;
  showLogout: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    setIsReady(true);
  }, []);

  async function logout(): Promise<void> {
    setError(null);
    setIsLoggingOut(true);

    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });

      if (!response.ok) {
        setError('Unable to log out. Please try again.');
        return;
      }

      window.location.assign('/login');
    } catch {
      setError('Unable to log out. Please try again.');
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.brand} href="/">
          Playlarr
        </a>

        {showLogout ? (
          <button
            className={styles.logout}
            disabled={!isReady || isLoggingOut}
            onClick={() => void logout()}
            type="button"
          >
            {isLoggingOut ? 'Logging out…' : 'Log out'}
          </button>
        ) : null}
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.content}>{children}</div>
    </div>
  );
}
