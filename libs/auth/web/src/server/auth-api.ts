import 'server-only';

import { fetchNestApi } from '@playlarr/shared-web-infrastructure';
import { cookies } from 'next/headers';

export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const cookieHeader = (await cookies()).toString();
  return fetchAuthStatus(cookieHeader);
}

export async function fetchAuthStatus(
  cookieHeader: string | null,
): Promise<AuthStatus> {
  const response = await fetchNestApi('/auth/status', cookieHeader);

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

export interface AuthConfiguration {
  enabled: boolean;
  username: string;
}

export async function getAuthConfiguration(): Promise<AuthConfiguration> {
  const cookieHeader = (await cookies()).toString();
  const response = await fetchNestApi('/auth/configuration', cookieHeader);

  if (!response.ok) {
    throw new Error('Authentication configuration is unavailable');
  }

  const configuration: unknown = await response.json();

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

  return {
    enabled: configuration.enabled,
    username: configuration.username,
  };
}
