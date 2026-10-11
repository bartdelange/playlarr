import { redirect } from 'next/navigation';

import { getAuthStatus } from '../auth-status';
import { AuthenticatedShell } from './authenticated-shell/authenticated-shell';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getAuthStatus();

  if (auth.enabled && !auth.authenticated) {
    redirect('/login');
  }

  return (
    <AuthenticatedShell showLogout={auth.enabled}>
      {children}
    </AuthenticatedShell>
  );
}
