import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuthModule } from '@playlarr/auth-server';
import { DatabaseModule } from '@playlarr/shared-database';
import { SettingsRepository } from '@playlarr/settings-persistence';
import { TidalRepository } from '@playlarr/tidal-persistence';
import request, { type Response as SupertestResponse } from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TidalModule } from './tidal.module.js';
import { TidalService } from './tidal.service.js';
import { tidalSettingsKey, tidalSettingsSchema } from './tidal-settings.js';

async function createApplication(databasePath: string) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [() => ({ app: { database: { path: databasePath } } })],
      }),
      DatabaseModule,
      AuthModule,
      TidalModule,
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.enableCsrfProtection();
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return app;
}

function cookie(response: SupertestResponse, name: string) {
  const cookies = response.headers['set-cookie'] as unknown as
    string[] | undefined;
  const value = cookies?.find((item) => item.startsWith(`${name}=`));
  if (!value) throw new Error(`Response did not set ${name}`);
  return value.split(';', 1)[0];
}

const configure = (
  app: INestApplication,
  overrides: Partial<{ clientId: string; redirectUri: string }> = {},
) =>
  request(app.getHttpServer())
    .post('/api/tidal/configuration')
    .set('Sec-Fetch-Site', 'same-origin')
    .send({
      clientId: 'client-id',
      redirectUri: 'https://playlarr.example/api/tidal/callback',
      ...overrides,
    });

async function startAuthorization(app: INestApplication) {
  const response = await request(app.getHttpServer())
    .get('/api/tidal/authorize?returnTo=%2Fsettings')
    .expect(302);
  const url = new URL(response.headers.location as string);
  expect(url.origin).toBe('https://login.tidal.com');
  expect(url.searchParams.get('scope')).toBe('user.read playlists.read');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  return {
    state: url.searchParams.get('state') as string,
    bindingCookie: cookie(response, 'playlarr_tidal_oauth'),
  };
}

describe('TIDAL authorization', () => {
  let app: INestApplication;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'playlarr-tidal-'));
    app = await createApplication(join(directory, 'playlarr.db'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function seedCredential(expiresAt: Date) {
    const settings = await app
      .get(SettingsRepository)
      .get(tidalSettingsKey, tidalSettingsSchema);
    if (!settings) throw new Error('TIDAL is not configured');
    await app.get(TidalRepository).saveCredentialIfConfigurationCurrent(
      {
        accessToken: 'access-one',
        refreshToken: 'refresh-one',
        expiresAt,
        scope: 'user.read playlists.read',
        accountId: 'account-1',
        reconnectRequired: false,
      },
      settings.revision,
    );
  }

  it('completes PKCE authorization and stores reusable server-side credentials', async () => {
    await configure(app).expect(201);
    const authorization = await startAuthorization(app);
    const provider = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        access_token: 'access-one',
        refresh_token: 'refresh-one',
        expires_in: 3600,
        scope: 'user.read playlists.read',
        user_id: 'account-1',
      }),
    );

    await request(app.getHttpServer())
      .get(`/api/tidal/callback?state=${authorization.state}&code=code`)
      .set('Cookie', authorization.bindingCookie)
      .expect('Location', '/settings?tidal=connected')
      .expect(302);

    expect(provider).toHaveBeenCalledOnce();
    expect(await app.get(TidalService).getAccessToken()).toBe('access-one');
    expect(await app.get(TidalRepository).getCredential()).toMatchObject({
      refreshToken: 'refresh-one',
      accountId: 'account-1',
      reconnectRequired: false,
    });
  });

  it('returns connection metadata without credential material', async () => {
    await configure(app).expect(201);
    await seedCredential(new Date(Date.now() + 3_600_000));

    const response = await request(app.getHttpServer())
      .get('/api/tidal/configuration')
      .expect(200);

    expect(response.body).toEqual({
      clientId: 'client-id',
      redirectUri: 'https://playlarr.example/api/tidal/callback',
      status: 'connected',
      account: { id: 'account-1' },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/access|refresh|token/i);
  });

  it('marks rejected expired authorization as requiring reconnect', async () => {
    await configure(app).expect(201);
    await seedCredential(new Date(Date.now() - 1_000));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );

    await expect(app.get(TidalService).getAccessToken()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      request(app.getHttpServer()).get('/api/tidal/configuration'),
    ).resolves.toMatchObject({ body: { status: 'reconnect_required' } });
  });

  it('invalidates credentials immediately when configuration changes', async () => {
    await configure(app).expect(201);
    await seedCredential(new Date(Date.now() + 3_600_000));

    await configure(app, { clientId: 'replacement-client' }).expect(201, {
      clientId: 'replacement-client',
      redirectUri: 'https://playlarr.example/api/tidal/callback',
      status: 'not_connected',
      account: null,
    });

    await expect(app.get(TidalService).getAccessToken()).rejects.toThrow(
      'Reconnect TIDAL in Settings',
    );
  });

  it('rejects callbacks that do not match the browser-bound attempt', async () => {
    await configure(app).expect(201);
    const authorization = await startAuthorization(app);

    await request(app.getHttpServer())
      .get(`/api/tidal/callback?state=${authorization.state}&code=code`)
      .set('Cookie', 'playlarr_tidal_oauth=wrong')
      .expect(400);

    expect(await app.get(TidalRepository).getCredential()).toBeNull();
  });
});
