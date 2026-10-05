import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfigurationRepository } from '@playlarr/auth-persistence';
import { hashPassword } from '@playlarr/auth-server';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../app/app.module.js';

const createApplication = async (): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();

  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');

  return app;
};

const sessionCookie = (setCookie: string[]): string => {
  const cookie = setCookie.find((value) =>
    value.startsWith('playlarr_session='),
  );

  if (!cookie) {
    throw new Error('Login response did not set a session cookie');
  }

  return cookie.split(';', 1)[0];
};

describe('optional authentication', () => {
  let app: INestApplication | undefined;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'playlarr-auth-'));
    vi.stubEnv('PLAYLARR_DATABASE_PATH', join(directory, 'playlarr.db'));
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;

    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it('distinguishes unconfigured authentication from explicitly disabled authentication', async () => {
    app = await createApplication();
    const configurations = app.get(AuthConfigurationRepository);

    await expect(configurations.find()).resolves.toBeNull();

    await request(app.getHttpServer()).get('/api/health').expect(200);
    await request(app.getHttpServer()).get('/api/auth/status').expect(200, {
      enabled: false,
      authenticated: true,
    });

    await configurations.save({
      enabled: false,
      username: '',
      passwordHash: '',
      sessionLifetimeSeconds: 2_592_000,
    });

    await expect(configurations.find()).resolves.toEqual({
      enabled: false,
      username: '',
      passwordHash: '',
      sessionLifetimeSeconds: 2_592_000,
    });
  });

  it('rejects unauthenticated access and invalid credentials', async () => {
    app = await createApplication();
    await enableAuthentication(app);

    await request(app.getHttpServer()).get('/api/commands/unknown').expect(401);

    const invalidLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'operator', password: 'incorrect' })
      .expect(401);

    expect(invalidLogin.headers['set-cookie']).toBeUndefined();
    await request(app.getHttpServer()).get('/api/commands/unknown').expect(401);
  });

  it('keeps the operational health endpoint public when authentication is enabled', async () => {
    app = await createApplication();
    await enableAuthentication(app);

    await request(app.getHttpServer()).get('/api/health').expect(200, {
      status: 'ok',
    });
  });

  it('persists a valid session across navigation and application restart', async () => {
    app = await createApplication();
    await enableAuthentication(app);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'operator', password: 'secret' })
      .expect(201, { authenticated: true });
    const setCookie = login.headers['set-cookie'] as unknown as string[];
    const cookie = sessionCookie(setCookie);

    expect(setCookie[0]).toContain('HttpOnly');
    expect(setCookie[0]).toContain('Secure');
    expect(setCookie[0]).toContain('SameSite=Strict');
    expect(setCookie[0]).toContain('Max-Age=3600');

    await request(app.getHttpServer())
      .get('/api/health')
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/auth/status')
      .set('Cookie', cookie)
      .expect(200, { enabled: true, authenticated: true });

    const command = await request(app.getHttpServer())
      .post('/api/sample-command')
      .set('Cookie', cookie)
      .send({ steps: 1 })
      .expect(201);
    const commandId = command.body.commandId as string;

    expect(commandId).toEqual(expect.any(String));

    await app.close();
    app = await createApplication();

    await request(app.getHttpServer())
      .get(`/api/commands/${commandId}`)
      .set('Cookie', cookie)
      .expect(200);
  });

  it('invalidates the current session on logout', async () => {
    app = await createApplication();
    await enableAuthentication(app);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'operator', password: 'secret' })
      .expect(201);
    const cookie = sessionCookie(
      login.headers['set-cookie'] as unknown as string[],
    );

    const logout = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .expect(201, { authenticated: false });

    expect(logout.headers['set-cookie']?.[0]).toContain('playlarr_session=;');

    await request(app.getHttpServer())
      .get('/api/commands/unknown')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('clears an invalid session cookie on logout', async () => {
    app = await createApplication();
    await enableAuthentication(app);

    const logout = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', 'playlarr_session=invalid')
      .expect(201, { authenticated: false });

    expect(logout.headers['set-cookie']?.[0]).toContain('playlarr_session=;');
  });
});

async function enableAuthentication(app: INestApplication): Promise<void> {
  const passwordHash = await hashPassword('secret');

  expect(passwordHash).not.toContain('secret');

  await app.get(AuthConfigurationRepository).save({
    enabled: true,
    username: 'operator',
    passwordHash,
    sessionLifetimeSeconds: 3_600,
  });
}
