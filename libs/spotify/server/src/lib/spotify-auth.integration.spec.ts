import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MikroORM } from '@mikro-orm/core';
import type { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuthModule } from '@playlarr/auth-server';
import { DatabaseModule } from '@playlarr/shared-database';
import { SpotifyRepository } from '@playlarr/spotify-persistence';
import { SettingsRepository } from '@playlarr/settings-persistence';
import request, { type Response as SupertestResponse } from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpotifyModule } from './spotify.module.js';
import { SpotifyService } from './spotify.service.js';
import {
  spotifySettingsKey,
  spotifySettingsSchema,
} from './spotify-settings.js';

async function createApplication(databasePath: string) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [() => ({ app: { database: { path: databasePath } } })],
      }),
      DatabaseModule,
      AuthModule,
      SpotifyModule,
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.enableCsrfProtection();
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return app;
}

const cookie = (response: SupertestResponse, name: string): string => {
  const cookies = response.headers['set-cookie'] as unknown as
    string[] | undefined;
  const value = cookies?.find((item) => item.startsWith(`${name}=`));
  if (!value) throw new Error(`Response did not set ${name}`);
  return value.split(';', 1)[0];
};

const setCookie = (response: SupertestResponse, name: string): string => {
  const cookies = response.headers['set-cookie'] as unknown as
    string[] | undefined;
  const value = cookies?.find((item) => item.startsWith(`${name}=`));
  if (!value) throw new Error(`Response did not set ${name}`);
  return value;
};

const configure = (
  app: INestApplication,
  overrides: Partial<{
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }> = {},
  sessionCookie?: string,
) => {
  const operation = request(app.getHttpServer())
    .post('/api/spotify/configuration')
    .set('Sec-Fetch-Site', 'same-origin')
    .send({
      clientId: 'client-id',
      clientSecret: 'server-secret',
      redirectUri: 'https://playlarr.example/api/spotify/callback',
      ...overrides,
    });
  return sessionCookie ? operation.set('Cookie', sessionCookie) : operation;
};

const startAuthorization = async (
  app: INestApplication,
  sessionCookie?: string,
) => {
  let operation = request(app.getHttpServer()).get(
    '/api/spotify/authorize?returnTo=%2Fsettings',
  );
  if (sessionCookie) operation = operation.set('Cookie', sessionCookie);
  const response = await operation.expect(302);
  const authorizationUrl = new URL(response.headers.location as string);
  expect(authorizationUrl.origin).toBe('https://accounts.spotify.com');
  expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe(
    'S256',
  );
  return {
    bindingCookie: cookie(response, 'playlarr_spotify_oauth'),
    bindingSetCookie: setCookie(response, 'playlarr_spotify_oauth'),
    state: authorizationUrl.searchParams.get('state') as string,
  };
};

describe('Spotify authorization', () => {
  let app: INestApplication;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'playlarr-spotify-'));
    app = await createApplication(join(directory, 'playlarr.db'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function seedCredential(
    overrides: Partial<{
      accessToken: string;
      expiresAt: Date;
      refreshToken: string;
    }> = {},
  ) {
    const settings = await app
      .get(SettingsRepository)
      .get(spotifySettingsKey, spotifySettingsSchema);
    if (!settings) throw new Error('Spotify is not configured');
    const saved = await app
      .get(SpotifyRepository)
      .saveCredentialIfConfigurationCurrent(
        {
          accessToken: 'access-one',
          refreshToken: 'refresh-one',
          expiresAt: new Date(Date.now() + 3_600_000),
          scope: 'playlist-read-private',
          accountId: 'account-1',
          displayName: 'Listener',
          reconnectRequired: false,
          ...overrides,
        },
        settings.revision,
      );
    expect(saved).toBe(true);
  }

  it('completes a browser-bound authorization and stores the account', async () => {
    await configure(app).expect(201);
    const authorization = await startAuthorization(app);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'access-one',
          refresh_token: 'refresh-one',
          expires_in: 3600,
          scope: 'playlist-read-private',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: 'account-1', display_name: 'Listener' }),
      );

    await request(app.getHttpServer())
      .get(`/api/spotify/callback?state=${authorization.state}&code=code`)
      .set('Cookie', authorization.bindingCookie)
      .expect('Location', '/settings?spotify=connected')
      .expect(302);

    expect(await app.get(SpotifyRepository).getCredential()).toMatchObject({
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      accountId: 'account-1',
      displayName: 'Listener',
      reconnectRequired: false,
    });
  });

  it('authorizes only from the browser and Playlarr session that started the flow', async () => {
    await configure(app).expect(201);
    const auth = await request(app.getHttpServer())
      .post('/api/auth/configuration')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ enabled: true, username: 'operator', password: 'secret' })
      .expect(201);
    const sessionCookie = cookie(auth, 'playlarr_session');
    const wrongBrowser = await startAuthorization(app, sessionCookie);
    const provider = vi.spyOn(globalThis, 'fetch');

    await request(app.getHttpServer())
      .get(`/api/spotify/callback?state=${wrongBrowser.state}&code=code`)
      .set('Cookie', 'playlarr_spotify_oauth=wrong-browser')
      .expect(400);
    expect(provider).not.toHaveBeenCalled();

    const missingSession = await startAuthorization(app, sessionCookie);
    await request(app.getHttpServer())
      .get(`/api/spotify/callback?state=${missingSession.state}&code=code`)
      .set('Cookie', missingSession.bindingCookie)
      .expect(400);

    const secondLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'operator', password: 'secret' })
      .expect(201);
    const otherSessionCookie = cookie(secondLogin, 'playlarr_session');
    const wrongSession = await startAuthorization(app, sessionCookie);
    await request(app.getHttpServer())
      .get(`/api/spotify/callback?state=${wrongSession.state}&code=code`)
      .set('Cookie', [wrongSession.bindingCookie, otherSessionCookie])
      .expect(400);

    const owned = await startAuthorization(app, sessionCookie);
    provider
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'owned-access',
          refresh_token: 'owned-refresh',
          expires_in: 3600,
          scope: '',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: 'account-1', display_name: 'Listener' }),
      );
    await request(app.getHttpServer())
      .get(`/api/spotify/callback?state=${owned.state}&code=code`)
      .set('Cookie', [owned.bindingCookie, sessionCookie])
      .expect('Location', '/settings?spotify=connected')
      .expect(302);

    const loggedOut = await startAuthorization(app, sessionCookie);
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', sessionCookie)
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/spotify/callback?state=${loggedOut.state}&code=code`)
      .set('Cookie', [loggedOut.bindingCookie, sessionCookie])
      .expect(400);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('keeps callback cookies secure except on supported HTTP loopback hosts', async () => {
    await configure(app).expect(201);

    const production = await startAuthorization(app);
    expect(production.bindingSetCookie).toContain('Secure');

    await configure(app, {
      redirectUri: 'http://127.0.0.1:3000/api/spotify/callback',
    }).expect(201);
    const loopback = await startAuthorization(app);
    expect(loopback.bindingSetCookie).not.toContain('Secure');
    expect(loopback.bindingSetCookie).toContain('HttpOnly');
    expect(loopback.bindingSetCookie).toContain('SameSite=Lax');
  });

  it('does not commit authorization completed under superseded configuration', async () => {
    await configure(app).expect(201);
    const authorization = await startAuthorization(app);
    let releaseToken!: () => void;
    const tokenBlocked = new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    let tokenRequested!: () => void;
    const tokenStarted = new Promise<void>((resolve) => {
      tokenRequested = resolve;
    });
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => {
        tokenRequested();
        await tokenBlocked;
        return Response.json({
          access_token: 'stale-access',
          refresh_token: 'stale-refresh',
          expires_in: 3600,
          scope: '',
        });
      })
      .mockResolvedValueOnce(
        Response.json({ id: 'account-1', display_name: 'Listener' }),
      );

    const callbackResult = request(app.getHttpServer())
      .get(`/api/spotify/callback?state=${authorization.state}&code=code`)
      .set('Cookie', authorization.bindingCookie)
      .then((response) => response);
    await tokenStarted;
    await configure(app, {
      clientId: 'replacement-client',
      clientSecret: 'replacement-secret',
    }).expect(201);
    releaseToken();

    const response = await callbackResult;
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      '/settings?spotify=error&spotify_error=configuration_changed',
    );
    expect(await app.get(SpotifyRepository).getCredential()).toBeNull();
  });

  it('rolls back configuration when credential invalidation fails', async () => {
    await configure(app).expect(201);
    await seedCredential();
    const connection = app.get(MikroORM).em.getConnection();
    await connection.execute(`
      create trigger reject_spotify_credential_delete
      before delete on spotify_credentials
      begin
        select raise(abort, 'credential invalidation rejected');
      end;
    `);

    await configure(app, { clientId: 'replacement-client' }).expect(500);
    const settings = await app
      .get(SettingsRepository)
      .get(spotifySettingsKey, spotifySettingsSchema);
    expect(settings?.clientId).toBe('client-id');
    expect(
      (await app.get(SpotifyRepository).getCredential())?.accessToken,
    ).toBe('access-one');
  });

  it('refreshes and retries once after a resource 401', async () => {
    await configure(app).expect(201);
    await seedCredential();
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({ access_token: 'access-two', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          account_id: 'account-1',
          id: 'legacy',
          display_name: 'Listener',
        }),
      );

    await expect(app.get(SpotifyService).getCurrentUser()).resolves.toEqual({
      id: 'account-1',
      displayName: 'Listener',
    });
    expect(String(provider.mock.calls[1]?.[1]?.body)).toContain(
      'grant_type=refresh_token',
    );
    expect(provider.mock.calls[2]?.[1]?.headers).toEqual({
      Authorization: 'Bearer access-two',
    });
    expect(
      (await app.get(SpotifyRepository).getCredential())?.reconnectRequired,
    ).toBe(false);
  });

  it('shares a forced refresh without letting one failed retry poison it', async () => {
    await configure(app).expect(201);
    await seedCredential();
    let oldTokenCalls = 0;
    let newTokenCalls = 0;
    let refreshCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/api/token')) {
        refreshCalls += 1;
        return Response.json({ access_token: 'access-two', expires_in: 3600 });
      }
      const headers = init?.headers as { Authorization?: string };
      if (headers.Authorization === 'Bearer access-one') {
        oldTokenCalls += 1;
        return Response.json({}, { status: 401 });
      }
      newTokenCalls += 1;
      if (newTokenCalls === 1) return Response.json({}, { status: 401 });
      return Response.json({
        account_id: 'account-1',
        id: 'legacy',
        display_name: 'Listener',
      });
    });

    const results = await Promise.allSettled([
      app.get(SpotifyService).getCurrentUser(),
      app.get(SpotifyService).getCurrentUser(),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(oldTokenCalls).toBe(2);
    expect(refreshCalls).toBe(1);
    expect(
      (await app.get(SpotifyRepository).getCredential())?.reconnectRequired,
    ).toBe(false);
  });

  it('preserves newer credentials when a stale refresh grant is rejected', async () => {
    await configure(app).expect(201);
    await seedCredential({ expiresAt: new Date(0) });
    const settings = await app
      .get(SettingsRepository)
      .get(spotifySettingsKey, spotifySettingsSchema);
    if (!settings) throw new Error('Spotify is not configured');

    let releaseRefresh!: () => void;
    const refreshBlocked = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshRequested!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      refreshRequested = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      refreshRequested();
      await refreshBlocked;
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    });

    const staleRefresh = app.get(SpotifyService).getAccessToken();
    await refreshStarted;
    await app.get(SpotifyRepository).saveCredentialIfConfigurationCurrent(
      {
        accessToken: 'access-one',
        refreshToken: 'replacement-refresh',
        expiresAt: new Date(Date.now() + 3_600_000),
        scope: 'playlist-read-private',
        accountId: 'account-1',
        displayName: 'Listener',
        reconnectRequired: false,
      },
      settings.revision,
    );
    releaseRefresh();

    await expect(staleRefresh).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await app.get(SpotifyRepository).getCredential()).toMatchObject({
      accessToken: 'access-one',
      refreshToken: 'replacement-refresh',
      reconnectRequired: false,
    });
  });

  it('does not replace or invalidate credentials after configuration changes during refresh', async () => {
    await configure(app).expect(201);
    await seedCredential({ expiresAt: new Date(0) });
    let releaseRefresh!: () => void;
    const refreshBlocked = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshRequested!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      refreshRequested = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      refreshRequested();
      await refreshBlocked;
      return Response.json({ access_token: 'stale-result', expires_in: 3600 });
    });

    const staleRefresh = app.get(SpotifyService).getAccessToken();
    await refreshStarted;
    await app.get(SpotifyRepository).replaceConfiguration({
      clientId: 'replacement-client',
      clientSecret: 'replacement-secret',
      redirectUri: 'https://playlarr.example/api/spotify/callback',
      revision: 'replacement-revision',
    });
    await app.get(SpotifyRepository).saveCredentialIfConfigurationCurrent(
      {
        accessToken: 'access-one',
        refreshToken: 'replacement-refresh',
        expiresAt: new Date(Date.now() + 3_600_000),
        scope: 'playlist-read-private',
        accountId: 'account-2',
        displayName: 'Replacement',
        reconnectRequired: false,
      },
      'replacement-revision',
    );
    releaseRefresh();

    await expect(staleRefresh).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await app.get(SpotifyRepository).getCredential()).toMatchObject({
      accessToken: 'access-one',
      refreshToken: 'replacement-refresh',
      accountId: 'account-2',
      reconnectRequired: false,
    });
  });

  it('does not require reconnection for non-grant token endpoint failures', async () => {
    await configure(app).expect(201);
    await seedCredential({ expiresAt: new Date(0) });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ error: 'invalid_client' }, { status: 401 }),
    );

    await expect(app.get(SpotifyService).getAccessToken()).rejects.toThrow(
      'Spotify token service is unavailable',
    );
    expect(
      (await app.get(SpotifyRepository).getCredential())?.reconnectRequired,
    ).toBe(false);
  });

  it('requires reconnection only after refresh credentials are rejected', async () => {
    await configure(app).expect(201);
    await seedCredential({ expiresAt: new Date(0), refreshToken: 'revoked' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );

    await expect(
      app.get(SpotifyService).getAccessToken(),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(
      (await app.get(SpotifyRepository).getCredential())?.reconnectRequired,
    ).toBe(true);
  });

  it('maps provider callback errors to controlled result codes', async () => {
    await configure(app).expect(201);
    const denied = await startAuthorization(app);
    await request(app.getHttpServer())
      .get(`/api/spotify/callback?state=${denied.state}&error=access_denied`)
      .set('Cookie', denied.bindingCookie)
      .expect('Location', '/settings?spotify=error&spotify_error=access_denied')
      .expect(302);

    const unknown = await startAuthorization(app);
    await request(app.getHttpServer())
      .get(`/api/spotify/callback?state=${unknown.state}&error=private_detail`)
      .set('Cookie', unknown.bindingCookie)
      .expect(
        'Location',
        '/settings?spotify=error&spotify_error=provider_error',
      )
      .expect(302);
  });
});
