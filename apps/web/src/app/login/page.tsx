import { Login } from '@playlarr/auth-web';
import { redirect } from 'next/navigation';

import { getAuthStatus } from '../../server/auth-api';
import { safeReturnPath } from '../../server/safe-return-path';

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
