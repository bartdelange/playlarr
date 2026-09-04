import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from './app.module.js';

describe('Playlarr server', () => {
  let app: INestApplication | undefined;
  let directory: string | undefined;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'playlarr-server-'));

    vi.stubEnv('PLAYLARR_DATABASE_PATH', join(directory, 'playlarr.d'));

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    app.setGlobalPrefix('api');

    await app.init();
  });

  afterAll(async () => {
    await app?.close();

    vi.unstubAllEnvs();

    if (directory) {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }
  });

  it('reports healthy', async () => {
    if (!app) {
      throw new Error('Nest application was not initialized');
    }

    const response = await request(app.getHttpServer()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
    });
  });
});
