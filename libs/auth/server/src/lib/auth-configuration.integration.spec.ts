import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MikroORM } from '@mikro-orm/core';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DatabaseModule } from '@playlarr/shared-database';
import { SettingsRepository } from '@playlarr/settings-persistence';
import request, { type Response } from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthModule } from './auth.module.js';
import { authSettingsSchema } from './auth-settings.js';

const createApplication = async (
  databasePath: string,
): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [() => ({ app: { database: { path: databasePath } } })],
      }),
      DatabaseModule,
      AuthModule,
    ],
  }).compile();
  const app = moduleRef.createNestApplication();

  app.enableCsrfProtection();
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');

  return app;
};

const sessionCookie = (response: Response): string => {
  const cookies = response.headers['set-cookie'] as unknown as
    string[] | undefined;
  const cookie = cookies?.find((value) =>
    value.startsWith('playlarr_session='),
  );

  if (!cookie) {
    throw new Error('Response did not set a session cookie');
  }

  return cookie.split(';', 1)[0];
};

const configure = (
  app: INestApplication,
  body: { enabled: boolean; username: string; password?: string },
  cookie?: string,
) => {
  const operation = request(app.getHttpServer())
    .post('/api/auth/configuration')
    .set('Sec-Fetch-Site', 'same-origin')
    .send(body);

  return cookie ? operation.set('Cookie', cookie) : operation;
};

describe('authentication configuration', () => {
  let app: INestApplication;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'playlarr-auth-config-'));
    app = await createApplication(join(directory, 'playlarr.db'));
  });

  afterEach(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('enables authentication without exposing credentials or leaving configuration public', async () => {
    const configured = await configure(app, {
      enabled: true,
      username: 'operator',
      password: 'secret',
    }).expect(201, { enabled: true, username: 'operator' });
    const cookie = sessionCookie(configured);
    const persisted = await app
      .get(SettingsRepository)
      .get('auth', authSettingsSchema);

    expect(persisted?.passwordHash).not.toBe('secret');
    await request(app.getHttpServer())
      .get('/api/auth/configuration')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/auth/configuration')
      .set('Cookie', cookie)
      .expect(200, { enabled: true, username: 'operator' });
  });

  it('rolls back settings and session invalidation when replacement-session creation fails', async () => {
    const initial = await configure(app, {
      enabled: true,
      username: 'operator',
      password: 'secret',
    }).expect(201);
    const cookie = sessionCookie(initial);
    const connection = app.get(MikroORM).em.getConnection();

    await connection.execute(`
      create trigger reject_auth_session
      before insert on auth_sessions
      begin
        select raise(abort, 'replacement session rejected');
      end;
    `);

    await configure(
      app,
      {
        enabled: true,
        username: 'changed',
        password: 'changed-secret',
      },
      cookie,
    ).expect(500);

    await connection.execute('drop trigger reject_auth_session');

    await request(app.getHttpServer())
      .get('/api/auth/configuration')
      .set('Cookie', cookie)
      .expect(200, { enabled: true, username: 'operator' });
  });

  it('allows only one concurrent configuration decision from the same session', async () => {
    const initial = await configure(app, {
      enabled: true,
      username: 'operator',
      password: 'secret',
    }).expect(201);
    const cookie = sessionCookie(initial);

    const responses = await Promise.all([
      configure(
        app,
        { enabled: true, username: 'first', password: 'first-secret' },
        cookie,
      ),
      configure(
        app,
        { enabled: true, username: 'second', password: 'second-secret' },
        cookie,
      ),
    ]);
    const successful = responses.find((response) => response.status === 201);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 401]);
    expect(successful).toBeDefined();

    if (!successful) {
      throw new Error('Concurrent configuration did not succeed');
    }

    await request(app.getHttpServer())
      .get('/api/auth/configuration')
      .set('Cookie', sessionCookie(successful))
      .expect(200, successful.body);
  });

  it('does not let an old-credential login survive a concurrent credential change', async () => {
    const initial = await configure(app, {
      enabled: true,
      username: 'operator',
      password: 'secret',
    }).expect(201);
    const cookie = sessionCookie(initial);

    const [login, changed] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'operator', password: 'secret' }),
      configure(
        app,
        { enabled: true, username: 'changed', password: 'changed-secret' },
        cookie,
      ),
    ]);

    expect(changed.status).toBe(201);

    if (login.status === 201) {
      await request(app.getHttpServer())
        .get('/api/auth/configuration')
        .set('Cookie', sessionCookie(login))
        .expect(401);
    } else {
      expect(login.status).toBe(401);
    }
  });
});
