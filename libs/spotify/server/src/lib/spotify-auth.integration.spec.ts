import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DatabaseModule } from '@playlarr/shared-database';
import { SpotifyRepository } from '@playlarr/spotify-persistence';
import { SettingsRepository } from '@playlarr/settings-persistence';
import request from 'supertest';
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
      SpotifyModule,
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.enableCsrfProtection();
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return app;
}

const configure = (app: INestApplication, clientSecret = 'server-secret') =>
  request(app.getHttpServer())
    .post('/api/spotify/configuration')
    .set('Sec-Fetch-Site', 'same-origin')
    .send({
      clientId: 'client-id',
      clientSecret,
      redirectUri: 'https://playlarr.example/api/spotify/callback',
    });

const fetchState = async (app: INestApplication) => {
  const response = await request(app.getHttpServer())
    .get('/api/spotify/authorize?returnTo=%2Fsettings')
    .expect(302);
  const authorizationUrl = new URL(response.headers.location as string);
  expect(authorizationUrl.origin).toBe('https://accounts.spotify.com');
  expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe(
    'S256',
  );
  return authorizationUrl.searchParams.get('state') as string;
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

  it('configures and authorizes Spotify without exposing the client secret', async () => {
    const configured = await configure(app).expect(201);
    expect(configured.body).toEqual({
      clientId: 'client-id',
      redirectUri: 'https://playlarr.example/api/spotify/callback',
      clientSecretConfigured: true,
      status: 'not_connected',
      account: null,
    });
    expect(JSON.stringify(configured.body)).not.toContain('server-secret');
    expect(
      await app
        .get(SettingsRepository)
        .get(spotifySettingsKey, spotifySettingsSchema),
    ).toMatchObject({ clientSecret: 'server-secret' });

    const state = await fetchState(app);
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'access-one',
          refresh_token: 'refresh-one',
          expires_in: 3600,
          scope: 'playlist-read-private',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          account_id: 'account-1',
          id: 'legacy-id',
          display_name: 'Listener',
        }),
      );

    await request(app.getHttpServer())
      .get(`/api/spotify/callback?state=${state}&code=authorization-code`)
      .expect('Location', '/settings?spotify=connected')
      .expect(302);

    const tokenRequest = provider.mock.calls[0];
    expect(tokenRequest?.[1]?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('client-id:server-secret').toString('base64')}`,
    });
    expect(String(tokenRequest?.[1]?.body)).toContain('code_verifier=');
    await request(app.getHttpServer())
      .get('/api/spotify/configuration')
      .expect(200, {
        clientId: 'client-id',
        redirectUri: 'https://playlarr.example/api/spotify/callback',
        clientSecretConfigured: true,
        status: 'connected',
        account: { id: 'account-1', displayName: 'Listener' },
      });
  });

  it('refreshes an expired token and uses it for a subsequent Spotify API call', async () => {
    await configure(app).expect(201);
    await app.get(SpotifyRepository).saveCredential({
      accessToken: 'expired',
      refreshToken: 'refresh-one',
      expiresAt: new Date(Date.now() - 1_000),
      scope: 'playlist-read-private',
      accountId: 'account-1',
      displayName: 'Listener',
      reconnectRequired: false,
    });
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'access-two',
          expires_in: 3600,
          scope: 'playlist-read-private',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          account_id: 'account-1',
          id: 'legacy-id',
          display_name: 'Listener',
        }),
      );

    await expect(app.get(SpotifyService).getCurrentUser()).resolves.toEqual({
      id: 'account-1',
      displayName: 'Listener',
    });
    expect(String(provider.mock.calls[0]?.[1]?.body)).toContain(
      'grant_type=refresh_token',
    );
    expect(provider.mock.calls[1]?.[1]?.headers).toEqual({
      Authorization: 'Bearer access-two',
    });
    expect(
      (await app.get(SpotifyRepository).getCredential())?.refreshToken,
    ).toBe('refresh-one');
  });

  it('turns revoked refresh credentials into an actionable reconnect state', async () => {
    await configure(app).expect(201);
    await app.get(SpotifyRepository).saveCredential({
      accessToken: 'expired',
      refreshToken: 'revoked',
      expiresAt: new Date(0),
      scope: '',
      accountId: 'account-1',
      displayName: null,
      reconnectRequired: false,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );

    await expect(
      app.get(SpotifyService).getAccessToken(),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await request(app.getHttpServer())
      .get('/api/spotify/configuration')
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('reconnect_required'));
  });

  it('rejects invalid state before contacting Spotify and reports provider denial', async () => {
    await configure(app).expect(201);
    const provider = vi.spyOn(globalThis, 'fetch');
    await request(app.getHttpServer())
      .get('/api/spotify/callback?state=invalid&code=code')
      .expect(400);
    expect(provider).not.toHaveBeenCalled();

    const state = await fetchState(app);
    await request(app.getHttpServer())
      .get(`/api/spotify/callback?state=${state}&error=access_denied`)
      .expect('Location', '/settings?spotify=error&spotify_error=access_denied')
      .expect(302);
    expect(provider).not.toHaveBeenCalled();
  });
});
