import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from './app.module.js';

import {
  COMMAND_EVENT_PUBLISHER,
  CommandProcessor,
  CommandService,
} from '@playlarr/commands-server';
import { CommandRepository } from '@playlarr/commands-persistence';
import { ApplicationCommandEventPublisher } from '@playlarr/events-server';

const waitFor = async (
  predicate: () => Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for condition');
};

describe('Playlarr server', () => {
  let app: INestApplication;
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'playlarr-server-'));

    vi.stubEnv('PLAYLARR_DATABASE_PATH', join(directory, 'playlarr.db'));

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    app.setGlobalPrefix('api');

    await app.listen(0, '127.0.0.1');
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

  it('executes a feature-owned persisted command', async () => {
    const service = app.get(CommandService);
    const repository = app.get(CommandRepository);

    const id = await service.enqueue('sample.delay', {
      steps: 3,
    });

    expect(id).toEqual(expect.any(String));

    await waitFor(async () => {
      const command = await repository.findById(id);

      return command?.status === 'completed';
    });

    const command = await repository.findById(id);

    expect(command).toMatchObject({
      id,
      type: 'sample.delay',
      status: 'completed',
      current: 3,
      total: 3,
      attempts: 1,
      error: null,
    });

    expect(command?.completedAt).toBeInstanceOf(Date);
  });

  it('persists an unknown command type as failed', async () => {
    const service = app.get(CommandService);
    const repository = app.get(CommandRepository);

    const id = await service.enqueue('does.not.exist', {});

    await waitFor(async () => {
      const command = await repository.findById(id);

      return command?.status === 'failed';
    });

    const command = await repository.findById(id);

    expect(command).not.toBeNull();
    expect(command?.status).toBe('failed');
    expect(command?.error).toContain('Unsupported command type');
  });

  it('persists handler failures', async () => {
    const service = app.get(CommandService);
    const repository = app.get(CommandRepository);

    const id = await service.enqueue('sample.fail', {});

    await waitFor(async () => {
      const command = await repository.findById(id);

      return command?.status === 'failed';
    });

    const command = await repository.findById(id);

    expect(command).toMatchObject({
      status: 'failed',
      error: 'Intentional sample failure',
    });
  });

  it('streams persisted command progress through NestJS SSE', async () => {
    const repository = app.get(CommandRepository);
    const processor = app.get(CommandProcessor);
    const publisher = app.get(COMMAND_EVENT_PUBLISHER);
    const command = await repository.create('sample.delay', { steps: 2 });

    expect(publisher).toBe(app.get(ApplicationCommandEventPublisher));

    const abortController = new AbortController();
    const response = await fetch(
      `${await app.getUrl()}/api/events?commandId=${command.id}`,
      { signal: abortController.signal },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('SSE response did not include a readable body');
    }

    const decoder = new TextDecoder();
    let received = '';

    while (!received.includes('event: command.snapshot')) {
      const result = await reader.read();

      if (result.done) {
        throw new Error('SSE stream ended before the current-state snapshot');
      }

      received += decoder.decode(result.value, { stream: true });
    }

    const claimedCommand = await repository.claimNext();

    if (!claimedCommand) {
      throw new Error('Persisted sample command could not be claimed');
    }

    await processor.execute(claimedCommand);

    while (!received.includes('event: command.progress')) {
      const result = await reader.read();

      if (result.done) {
        throw new Error('SSE stream ended before live progress');
      }

      received += decoder.decode(result.value, { stream: true });
    }

    expect(received).toContain(`"id":"${command.id}"`);
    expect(received).toContain('event: command.progress');
    expect(received).toContain('"current":2');
    expect(received).toContain('event: command.completed');

    abortController.abort();
  });

  it('enqueues a feature-owned persisted command through HTTP', async () => {
    const repository = app.get(CommandRepository);

    const response = await request(app.getHttpServer())
      .post('/api/sample-command')
      .send({
        steps: 3,
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      commandId: expect.any(String),
    });

    const id = response.body.commandId as string;

    await waitFor(async () => {
      const command = await repository.findById(id);

      return command?.status === 'completed';
    });

    const command = await repository.findById(id);

    expect(command).toMatchObject({
      id,
      type: 'sample.delay',
      status: 'completed',
      current: 3,
      total: 3,
      attempts: 1,
      error: null,
    });

    expect(command?.completedAt).toBeInstanceOf(Date);

    const currentState = await request(app.getHttpServer()).get(
      `/api/commands/${id}`,
    );

    expect(currentState.status).toBe(200);
    expect(currentState.body).toMatchObject({
      id,
      type: 'sample.delay',
      status: 'completed',
      current: 3,
      total: 3,
      attempts: 1,
      completedAt: expect.any(String),
    });
    expect(currentState.body).not.toHaveProperty('payloadJson');
  });
});
