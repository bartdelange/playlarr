import type { ReactNode } from 'react';

import styles from './settings.module.css';

export default function SettingsLayout({ children }: { children: ReactNode }) {
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
