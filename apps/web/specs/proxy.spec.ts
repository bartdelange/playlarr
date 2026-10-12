import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

import { config, proxy } from '../src/proxy';

describe('protected frontend navigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects an unauthenticated request to login when authentication is enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ enabled: true, authenticated: false }),
        ),
    );

    const response = await proxy(
      new NextRequest('http://playlarr.test/settings?tab=lidarr'),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://playlarr.test/login?next=%2Fsettings%3Ftab%3Dlidarr',
    );
  });

  it.each([
    '/api/health',
    '/login',
    '/login/help',
    '/_next/static/app.js',
    '/favicon.ico',
  ])('leaves the public path %s outside the proxy', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(
      false,
    );
  });

  it('continues navigation when authentication is disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ enabled: false, authenticated: true }),
        ),
    );

    const response = await proxy(new NextRequest('http://playlarr.test/'));

    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('continues navigation for an authenticated request', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ enabled: true, authenticated: true }),
        ),
    );

    const response = await proxy(new NextRequest('http://playlarr.test/'));

    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('forwards the session cookie only to the server-side status check', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ enabled: true, authenticated: true }));
    vi.stubGlobal('fetch', fetchMock);

    await proxy(
      new NextRequest('http://playlarr.test/', {
        headers: { cookie: 'playlarr_session=secret-session' },
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/api/auth/status',
      expect.objectContaining({
        headers: { cookie: 'playlarr_session=secret-session' },
      }),
    );
  });

  it('fails closed when authentication status cannot be checked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unavailable')));

    const response = await proxy(new NextRequest('http://playlarr.test/'));

    expect(response.status).toBe(503);
  });

  it.each([
    Response.json({ enabled: true }),
    Response.json({ enabled: 'yes', authenticated: true }),
    new Response('not json'),
  ])('fails closed for a malformed authentication status', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(status));

    const response = await proxy(new NextRequest('http://playlarr.test/'));

    expect(response.status).toBe(503);
  });

  it('does not create a protocol-relative return destination', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ enabled: true, authenticated: false }),
        ),
    );

    const response = await proxy(
      new NextRequest('http://playlarr.test//attacker.example'),
    );

    expect(response.headers.get('location')).toBe(
      'http://playlarr.test/login?next=%2F',
    );
  });
});
