import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/sqlite';
import { Logger } from '@nestjs/common';
import {
  type CommandEventPublisher,
  type CommandEventType,
  type CommandHandler,
} from '@playlarr/commands-domain';
import {
  CommandEntity,
  CommandRepository,
} from '@playlarr/commands-persistence';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandHandlerRegistry } from './command-handler.registry.js';
import {
  COMMAND_SHUTDOWN_GRACE_MS,
  CommandProcessor,
} from './command.processor.js';
import { CommandRuntimeLifecycle } from './command-runtime-lifecycle.js';
import { CommandWakeSignal } from './command-wake-signal.js';
import type { CriticalFailureHandler } from './critical-failure.handler.js';

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

class RecordingCommandEventPublisher implements CommandEventPublisher {
  readonly events: Array<{
    type: CommandEventType;
    status?: string;
    error?: string;
  }> = [];

  constructor(private readonly repository: CommandRepository) {}

  async publish(commandId: string, type: CommandEventType): Promise<void> {
    const command = await this.repository.findStateById(commandId);

    this.events.push({
      type,
      ...(command === null ? {} : { status: command.status }),
      ...(command?.error === undefined ? {} : { error: command.error }),
    });
  }
}

describe('CommandProcessor', () => {
  let directory: string;
  let databasePath: string;

  let orm: MikroORM;
  let repository: CommandRepository;
  let registry: CommandHandlerRegistry;
  let wakeSignal: CommandWakeSignal;
  let eventPublisher: RecordingCommandEventPublisher;
  let lifecycle: CommandRuntimeLifecycle;
  let criticalFailureHandler: CriticalFailureHandler;
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
    eventPublisher = new RecordingCommandEventPublisher(repository);
    lifecycle = new CommandRuntimeLifecycle();
    criticalFailureHandler = {
      terminate: vi.fn(),
      forceTerminate: vi.fn(),
    };

    processor = new CommandProcessor(
      repository,
      registry,
      wakeSignal,
      eventPublisher,
      lifecycle,
      criticalFailureHandler,
    );
  });

  afterEach(async () => {
    await processor.beforeApplicationShutdown();

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

  it('publishes persisted command lifecycle state in order', async () => {
    const handler = {
      type: 'test.events',
      retryInterrupted: true,

      execute: vi.fn(async (_payload, progress) => {
        await progress.report({ current: 1, total: 1 });
      }),
    } satisfies CommandHandler<unknown>;

    registry.register(handler);

    const command = await repository.create('test.events', {});
    await processor.onApplicationBootstrap();

    await waitFor(async () => {
      const result = await repository.findById(command.id);

      return result?.status === 'completed';
    });

    expect(eventPublisher.events).toEqual([
      { type: 'command.started', status: 'running' },
      { type: 'command.progress', status: 'running' },
      { type: 'command.completed', status: 'completed' },
    ]);
  });

  it('continues execution when event state cannot be loaded', async () => {
    const loggerWarn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const handler = {
      type: 'test.observer-failure',
      retryInterrupted: true,

      execute: vi.fn(async () => undefined),
    } satisfies CommandHandler<unknown>;

    registry.register(handler);

    const command = await repository.create('test.observer-failure', {});
    vi.spyOn(eventPublisher, 'publish').mockRejectedValueOnce(
      new Error('Notification delivery failed'),
    );

    await processor.onApplicationBootstrap();

    await waitFor(async () => {
      const result = await repository.findById(command.id);

      return result?.status === 'completed';
    });

    expect(handler.execute).toHaveBeenCalledOnce();
    expect(loggerWarn).toHaveBeenCalledWith(
      `Failed to publish command.started for command ${command.id}`,
      expect.stringContaining('Notification delivery failed'),
    );
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
    expect(eventPublisher.events.at(-1)).toEqual({
      type: 'command.failed',
      status: 'failed',
      error: 'Intentional failure',
    });
  });

  it('recovers a retryable command after the database is reopened', async () => {
    const command = await repository.create('test.retryable', {});

    const claimed = await repository.claimNext();

    expect(claimed?.id).toBe(command.id);
    expect(claimed?.attempts).toBe(1);

    await processor.beforeApplicationShutdown();
    await orm.close(true);

    orm = await MikroORM.init({
      dbName: databasePath,
      entities: [CommandEntity],
      metadataProvider: ReflectMetadataProvider,
    });

    repository = new CommandRepository(orm);
    registry = new CommandHandlerRegistry();
    wakeSignal = new CommandWakeSignal();
    eventPublisher = new RecordingCommandEventPublisher(repository);
    lifecycle = new CommandRuntimeLifecycle();
    criticalFailureHandler = {
      terminate: vi.fn(),
      forceTerminate: vi.fn(),
    };
    processor = new CommandProcessor(
      repository,
      registry,
      wakeSignal,
      eventPublisher,
      lifecycle,
      criticalFailureHandler,
    );

    const handler = {
      type: 'test.retryable',
      retryInterrupted: true,

      execute: vi.fn(async () => undefined),
    } satisfies CommandHandler<unknown>;

    registry.register(handler);
    const requeue = vi.spyOn(repository, 'requeue');

    await processor.onApplicationBootstrap();

    await waitFor(async () => {
      const result = await repository.findById(command.id);

      return result?.status === 'completed';
    });

    const result = await repository.findById(command.id);

    expect(result?.status).toBe('completed');

    expect(result?.attempts).toBe(2);

    expect(requeue).toHaveBeenCalledOnce();
    expect(requeue).toHaveBeenCalledWith(command.id);

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

    const shutdown = processor.beforeApplicationShutdown();

    release();

    await shutdown;

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

  it('requeues a command claimed while shutdown begins', async () => {
    const handler = {
      type: 'test.claim-race',
      retryInterrupted: true,
      execute: vi.fn(async () => undefined),
    } satisfies CommandHandler<unknown>;
    registry.register(handler);

    const command = await repository.create('test.claim-race', {});
    const claimNext = repository.claimNext.bind(repository);
    let releaseClaim!: () => void;
    const claimBlocked = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    vi.spyOn(repository, 'claimNext').mockImplementationOnce(async () => {
      await claimBlocked;

      return claimNext();
    });

    await processor.onApplicationBootstrap();
    await vi.waitFor(() => {
      expect(repository.claimNext).toHaveBeenCalledOnce();
    });

    const shutdown = processor.beforeApplicationShutdown();
    releaseClaim();
    await shutdown;

    const result = await repository.findById(command.id);

    expect(result?.status).toBe('queued');
    expect(result?.attempts).toBe(0);
    expect(result?.startedAt).toBeNull();
    expect(handler.execute).not.toHaveBeenCalled();
    expect(eventPublisher.events).toEqual([]);
  });

  it('forces termination when active work exceeds the shutdown grace period', async () => {
    vi.useFakeTimers();

    try {
      const handler = {
        type: 'test.stuck',
        retryInterrupted: true,
        execute: vi.fn(() => new Promise<void>(() => undefined)),
      } satisfies CommandHandler<unknown>;
      registry.register(handler);

      const command = await repository.create('test.stuck', {});
      await processor.onApplicationBootstrap();
      await vi.waitFor(async () => {
        expect((await repository.findById(command.id))?.status).toBe('running');
      });

      const firstShutdown = processor.beforeApplicationShutdown();
      const repeatedShutdown = processor.beforeApplicationShutdown();

      expect(repeatedShutdown).toBe(firstShutdown);

      await vi.advanceTimersByTimeAsync(COMMAND_SHUTDOWN_GRACE_MS);
      await firstShutdown;

      expect(criticalFailureHandler.forceTerminate).toHaveBeenCalledOnce();
      expect((await repository.findById(command.id))?.status).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails the backend when command claiming fails critically', async () => {
    const failure = new Error('Database unavailable');

    vi.spyOn(repository, 'claimNext').mockRejectedValue(failure);

    await processor.onApplicationBootstrap();

    await waitFor(
      async () =>
        vi.mocked(criticalFailureHandler.terminate).mock.calls.length === 1,
    );

    expect(lifecycle.isAcceptingWork()).toBe(false);
    expect(criticalFailureHandler.terminate).toHaveBeenCalledWith(failure);
  });
});
