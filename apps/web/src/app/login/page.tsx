import { Login } from '@playlarr/auth-web';
import { redirect } from 'next/navigation';

import { safeReturnPath } from '@playlarr/auth-web/return-path';
import { getAuthStatus } from '@playlarr/auth-web/server';

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

  return <Login destination={destination} />;
}
