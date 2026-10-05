import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
}

const backendHost = process.env['PLAYLARR_SERVER_HOST'] ?? '127.0.0.1';
const backendPort = process.env['PLAYLARR_SERVER_PORT'] ?? '3001';

export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response: Response;

  try {
    response = await fetch(
      `http://${backendHost}:${backendPort}/api/auth/status`,
      {
        cache: 'no-store',
        headers: {
          cookie: request.headers.get('cookie') ?? '',
        },
      },
    );
  } catch {
    return NextResponse.json(
      { message: 'Authentication status is unavailable' },
      { status: 503 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { message: 'Authentication status is unavailable' },
      { status: 503 },
    );
  }

  const status = (await response.json()) as AuthStatus;

  if (status.enabled && !status.authenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set(
      'next',
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );

    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|login|_next/static|_next/image|favicon.ico).*)'],
};
