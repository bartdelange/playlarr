import { redirect } from 'next/navigation';

import { getAuthStatus } from '../auth-status';
import { LoginForm } from './login-form/login-form';
import { safeReturnPath } from './return-path';
import styles from './login.module.css';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const destination = safeReturnPath((await searchParams).next);
  const auth = await getAuthStatus();

  if (!auth.enabled || auth.authenticated) {
    redirect(destination);
  }

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
