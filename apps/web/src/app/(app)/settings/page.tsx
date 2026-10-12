import { cookies } from 'next/headers';

import {
  AuthenticationSettings,
  type AuthConfiguration,
} from '../../../features/authentication/authentication-settings/authentication-settings';

async function getConfiguration(): Promise<AuthConfiguration> {
  const backendHost = process.env.PLAYLARR_BACKEND_HOST ?? '127.0.0.1';
  const backendPort = process.env.PLAYLARR_BACKEND_PORT ?? '3001';
  const cookieStore = await cookies();
  const response = await fetch(
    `http://${backendHost}:${backendPort}/api/auth/configuration`,
    {
      cache: 'no-store',
      headers: { cookie: cookieStore.toString() },
    },
  );

  if (!response.ok) {
    throw new Error('Authentication configuration is unavailable');
  }

  const configuration = (await response.json()) as unknown;

  if (
    typeof configuration !== 'object' ||
    configuration === null ||
    !('enabled' in configuration) ||
    typeof configuration.enabled !== 'boolean' ||
    !('username' in configuration) ||
    typeof configuration.username !== 'string'
  ) {
    throw new Error('Authentication configuration is invalid');
  }

  return configuration as AuthConfiguration;
}

export default async function SettingsPage() {
  return (
    <AuthenticationSettings initialConfiguration={await getConfiguration()} />
  );
}
