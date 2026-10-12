import type { ReactNode } from 'react';

import styles from './settings-shell.module.css';

export function SettingsShell({ children }: { children: ReactNode }) {
  return (
    <main>
      <header className={styles.header}>
        <h1>Settings</h1>
        <p>Configure the capabilities available in this Playlarr instance.</p>
      </header>

      <div className={styles.layout}>
        <nav aria-label="Settings" className={styles.navigation}>
          <a aria-current="page" href="/settings">
            Authentication
          </a>
        </nav>

        <div className={styles.content}>{children}</div>
      </div>
    </main>
  );
}
