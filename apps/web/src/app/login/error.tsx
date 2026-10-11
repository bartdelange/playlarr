'use client';

import styles from './login.module.css';

export default function LoginError({ reset }: { reset: () => void }) {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1>Unable to load login</h1>
        <p className={styles.intro}>Playlarr could not check authentication.</p>
        <button onClick={reset} type="button">
          Try again
        </button>
      </section>
    </main>
  );
}
