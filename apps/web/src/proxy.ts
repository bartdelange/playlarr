import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { fetchAuthStatus } from '@playlarr/auth-web/server';

const unavailableResponse = () =>
  NextResponse.json(
    { message: 'Authentication status is unavailable' },
    { status: 503 },
  );

export async function proxy(request: NextRequest): Promise<NextResponse> {
  let status: Awaited<ReturnType<typeof fetchAuthStatus>>;

  try {
    status = await fetchAuthStatus(request.headers.get('cookie'));
  } catch {
    return unavailableResponse();
  }

  const destination = request.nextUrl.pathname.startsWith('//')
    ? '/'
    : `${request.nextUrl.pathname}${request.nextUrl.search}`;

  if (status.enabled && !status.authenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', destination);

    return NextResponse.redirect(loginUrl);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-playlarr-path', destination);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!api(?:/|$)|login(?:/|$)|_next/|.*\\..*$).*)'],
};
