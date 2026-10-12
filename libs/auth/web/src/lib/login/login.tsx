'use client';

import { LoginForm } from './login-form.js';
import styles from './login.module.css';

export function Login({ destination }: { destination: string }) {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="login-heading">
        <p className={styles.brand}>Playlarr</p>
        <h1 id="login-heading">Log in</h1>
        <p className={styles.intro}>Enter your credentials to continue.</p>
        <LoginForm destination={destination} />
      </section>
    </main>
  );
}

export function LoginUnavailable({ reset }: { reset: () => void }) {
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

export function LoginLoading() {
  return (
    <main className={styles.page}>
      <p role="status">Loading Playlarr…</p>
    </main>
  );
}
