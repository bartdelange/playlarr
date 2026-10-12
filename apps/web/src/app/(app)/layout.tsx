import { AuthenticatedShell } from '@playlarr/auth-web';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { safeReturnPath } from '../../server/safe-return-path';
import { getAuthStatus } from '../../server/auth-api';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getAuthStatus();

  if (auth.enabled && !auth.authenticated) {
    const destination = safeReturnPath(
      (await headers()).get('x-playlarr-path') ?? undefined,
    );

    redirect(`/login?next=${encodeURIComponent(destination)}`);
  }

  return (
    <AuthenticatedShell showLogout={auth.enabled}>
      {children}
    </AuthenticatedShell>
  );
}
