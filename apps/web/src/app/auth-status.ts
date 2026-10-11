import 'server-only';

import { cookies } from 'next/headers';

export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
}

const backendHost = process.env['PLAYLARR_SERVER_HOST'] ?? '127.0.0.1';
const backendPort = process.env['PLAYLARR_SERVER_PORT'] ?? '3001';

export async function getAuthStatus(): Promise<AuthStatus> {
  const cookieHeader = (await cookies()).toString();
  const response = await fetch(
    `http://${backendHost}:${backendPort}/api/auth/status`,
    {
      cache: 'no-store',
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    },
  );

  if (!response.ok) {
    throw new Error('Authentication status is unavailable');
  }

  const status: unknown = await response.json();

  if (
    typeof status !== 'object' ||
    status === null ||
    !('enabled' in status) ||
    typeof status.enabled !== 'boolean' ||
    !('authenticated' in status) ||
    typeof status.authenticated !== 'boolean'
  ) {
    throw new Error('Authentication status is invalid');
  }

  return {
    enabled: status.enabled,
    authenticated: status.authenticated,
  };
}
