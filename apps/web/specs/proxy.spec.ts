import { NextRequest } from 'next/server';

import { proxy } from '../src/proxy';

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
});
