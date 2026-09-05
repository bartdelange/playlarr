import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/sqlite';
import type { CommandHandler } from '@playlarr/commands-domain';
import {
  CommandEntity,
  CommandRepository,
} from '@playlarr/commands-persistence';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandHandlerRegistry } from './command-handler.registry.js';
import { CommandProcessor } from './command.processor.js';
import { CommandWakeSignal } from './command-wake-signal.js';

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

describe('CommandProcessor', () => {
  let directory: string;
  let databasePath: string;

  let orm: MikroORM;
  let repository: CommandRepository;
  let registry: CommandHandlerRegistry;
  let wakeSignal: CommandWakeSignal;
  let processor: CommandProcessor;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'playlarr-command-processor-'));

    databasePath = join(directory, 'commands.sqlite');

    orm = await MikroORM.init({
      dbName: databasePath,
      entities: [CommandEntity],
      metadataProvider: ReflectMetadataProvider,
    });

    await orm.schema.create();

    repository = new CommandRepository(orm);
    registry = new CommandHandlerRegistry();
    wakeSignal = new CommandWakeSignal();

    processor = new CommandProcessor(repository, registry, wakeSignal);
  });

  afterEach(async () => {
    processor.onApplicationShutdown();

    await orm.close(true);

    await rm(directory, {
      recursive: true,
      force: true,
    });
  });

  it('processes work that was queued before startup', async () => {
    const handler = {
      type: 'test.command',
      retryInterrupted: true,

      execute: vi.fn(async () => undefined),
    } satisfies CommandHandler<unknown>;

    registry.register(handler);

    const command = await repository.create('test.command', {
      hello: 'world',
    });

    await processor.onApplicationBootstrap();

    await waitFor(async () => {
      const result = await repository.findById(command.id);

      return result?.status === 'completed';
    });

    const result = await repository.findById(command.id);

    expect(result?.status).toBe('completed');

    expect(result?.attempts).toBe(1);

    expect(handler.execute).toHaveBeenCalledOnce();

    expect(handler.execute).toHaveBeenCalledWith(
      {
        hello: 'world',
      },
      expect.objectContaining({
        report: expect.any(Function),
      }),
    );
  });

  it('persists progress reported by a handler', async () => {
    const handler = {
      type: 'test.progress',
      retryInterrupted: true,

      execute: vi.fn(async (_payload, progress) => {
        await progress.report({
          current: 2,
          total: 5,
          currentItem: 'Thing 2',
        });
      }),
    } satisfies CommandHandler<unknown>;

    registry.register(handler);

    const command = await repository.create('test.progress', {});

    await processor.onApplicationBootstrap();

    await waitFor(async () => {
      const result = await repository.findById(command.id);

      return result?.status === 'completed';
    });

    const result = await repository.findById(command.id);

    expect(result).toMatchObject({
      status: 'completed',
      current: 2,
      total: 5,
      currentItem: 'Thing 2',
    });
  });

  it('fails commands with an unknown type', async () => {
    const command = await repository.create('does.not.exist', {});

    await processor.onApplicationBootstrap();

    await waitFor(async () => {
      const result = await repository.findById(command.id);

      return result?.status === 'failed';
    });

    const result = await repository.findById(command.id);

    expect(result?.status).toBe('failed');

    expect(result?.error).toContain('Unsupported command type');
  });

  it('persists errors thrown by handlers', async () => {
    const handler = {
      type: 'test.failure',
      retryInterrupted: false,

      execute: vi.fn(async () => {
        throw new Error('Intentional failure');
      }),
    } satisfies CommandHandler<unknown>;

    registry.register(handler);

    const command = await repository.create('test.failure', {});

    await processor.onApplicationBootstrap();

    await waitFor(async () => {
      const result = await repository.findById(command.id);

      return result?.status === 'failed';
    });

    const result = await repository.findById(command.id);

    expect(result).toMatchObject({
      status: 'failed',
      error: 'Intentional failure',
    });
  });

  it('retries interrupted commands when the handler allows it', async () => {
    const handler = {
      type: 'test.retryable',
      retryInterrupted: true,

      execute: vi.fn(async () => undefined),
    } satisfies CommandHandler<unknown>;

    registry.register(handler);

    const command = await repository.create('test.retryable', {});

    const claimed = await repository.claimNext();

    expect(claimed?.id).toBe(command.id);
    expect(claimed?.attempts).toBe(1);

    await processor.onApplicationBootstrap();

    await waitFor(async () => {
      const result = await repository.findById(command.id);

      return result?.status === 'completed';
    });

    const result = await repository.findById(command.id);

    expect(result?.status).toBe('completed');

    expect(result?.attempts).toBe(2);

    expect(handler.execute).toHaveBeenCalledOnce();
  });

  it('fails interrupted commands when retry is unsafe', async () => {
    const handler = {
      type: 'test.unsafe',
      retryInterrupted: false,

      execute: vi.fn(async () => undefined),
    } satisfies CommandHandler<unknown>;

    registry.register(handler);

    const command = await repository.create('test.unsafe', {});

    await repository.claimNext();

    await processor.onApplicationBootstrap();

    await waitFor(async () => {
      const result = await repository.findById(command.id);

      return result?.status === 'failed';
    });

    const result = await repository.findById(command.id);

    expect(result?.status).toBe('failed');

    expect(result?.error).toBe('Command interrupted by application restart');

    expect(handler.execute).not.toHaveBeenCalled();
  });

  it('fails interrupted commands whose handler no longer exists', async () => {
    const command = await repository.create('removed.command', {});

    await repository.claimNext();

    await processor.onApplicationBootstrap();

    await waitFor(async () => {
      const result = await repository.findById(command.id);

      return result?.status === 'failed';
    });

    const result = await repository.findById(command.id);

    expect(result?.status).toBe('failed');

    expect(result?.error).toContain('Unsupported command type');
  });

  it('stops claiming new commands during shutdown', async () => {
    let release!: () => void;

    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const handler = {
      type: 'test.blocking',
      retryInterrupted: false,

      execute: vi.fn(async () => {
        await blocked;
      }),
    } satisfies CommandHandler<unknown>;

    registry.register(handler);

    const first = await repository.create('test.blocking', {});

    await processor.onApplicationBootstrap();

    await waitFor(async () => {
      const result = await repository.findById(first.id);

      return result?.status === 'running';
    });

    const second = await repository.create('test.blocking', {});

    processor.onApplicationShutdown();

    release();

    await waitFor(async () => {
      const result = await repository.findById(first.id);

      return result?.status === 'completed';
    });

    const firstResult = await repository.findById(first.id);

    const secondResult = await repository.findById(second.id);

    expect(firstResult?.status).toBe('completed');

    expect(secondResult?.status).toBe('queued');

    expect(handler.execute).toHaveBeenCalledOnce();
  });
});
