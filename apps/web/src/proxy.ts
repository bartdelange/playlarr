import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const backendHost = process.env['PLAYLARR_SERVER_HOST'] ?? '127.0.0.1';
const backendPort = process.env['PLAYLARR_SERVER_PORT'] ?? '3001';
const unavailableResponse = () =>
  NextResponse.json(
    { message: 'Authentication status is unavailable' },
    { status: 503 },
  );

export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response: Response;

  try {
    const cookie = request.headers.get('cookie');
    response = await fetch(
      `http://${backendHost}:${backendPort}/api/auth/status`,
      {
        cache: 'no-store',
        headers: cookie ? { cookie } : undefined,
      },
    );
  } catch {
    return unavailableResponse();
  }

  if (!response.ok) {
    return unavailableResponse();
  }

  let status: unknown;

  try {
    status = await response.json();
  } catch {
    return unavailableResponse();
  }

  if (
    typeof status !== 'object' ||
    status === null ||
    !('enabled' in status) ||
    typeof status.enabled !== 'boolean' ||
    !('authenticated' in status) ||
    typeof status.authenticated !== 'boolean'
  ) {
    return unavailableResponse();
  }

  if (status.enabled && !status.authenticated) {
    const loginUrl = new URL('/login', request.url);
    const destination = request.nextUrl.pathname.startsWith('//')
      ? '/'
      : `${request.nextUrl.pathname}${request.nextUrl.search}`;
    loginUrl.searchParams.set('next', destination);

    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api(?:/|$)|login(?:/|$)|_next/|.*\\..*$).*)'],
};
