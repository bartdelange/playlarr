import { BadRequestException } from '@nestjs/common';
import type { CommandState } from '@playlarr/commands-domain';
import { CommandRepository } from '@playlarr/commands-persistence';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationEventBus } from './application-event-bus.js';
import { ApplicationEventsController } from './application-events.controller.js';

const commandState = (
  revision: number,
  current: number,
  status: CommandState['status'] = 'running',
  updatedAt = '2026-09-30T10:00:01.000Z',
): CommandState => ({
  id: 'command-1',
  type: 'test.command',
  status,
  current,
  total: 3,
  attempts: 1,
  revision,
  createdAt: '2026-09-30T10:00:00.000Z',
  updatedAt,
  startedAt: '2026-09-30T10:00:01.000Z',
  ...(status === 'completed'
    ? { completedAt: '2026-09-30T10:00:04.000Z' }
    : {}),
});

describe('ApplicationEventsController', () => {
  const subscriptions: Array<{ unsubscribe(): void }> = [];

  afterEach(() => {
    for (const subscription of subscriptions) {
      subscription.unsubscribe();
    }

    subscriptions.length = 0;
  });

  it('rejects mutually incompatible command and scope filters', () => {
    const repository = Object.create(
      CommandRepository.prototype,
    ) as CommandRepository;
    const controller = new ApplicationEventsController(
      new ApplicationEventBus(),
      repository,
    );

    expect(() => controller.events('command-1', 'imports')).toThrow(
      new BadRequestException('commandId and scope filters cannot be combined'),
    );
  });

  it('reconciles a command-scoped connection from persisted current state', async () => {
    const completedCommand = commandState(
      3,
      3,
      'completed',
      '2026-09-30T10:00:04.000Z',
    );
    const repository = Object.create(
      CommandRepository.prototype,
    ) as CommandRepository;
    const findStateById = vi
      .spyOn(repository, 'findStateById')
      .mockResolvedValue(completedCommand);
    const eventBus = new ApplicationEventBus();
    const controller = new ApplicationEventsController(eventBus, repository);
    const messages: unknown[] = [];

    const droppedConnection = controller
      .events('  command-1  ')
      .subscribe((event) => {
        messages.push(event);
      });

    subscriptions.push(droppedConnection);

    await vi.waitFor(() => {
      expect(messages).toHaveLength(1);
    });

    expect(findStateById).toHaveBeenCalledWith('command-1');
    expect(messages[0]).toMatchObject({
      type: 'command.snapshot',
      data: {
        type: 'command.snapshot',
        command: completedCommand,
      },
    });

    droppedConnection.unsubscribe();
    messages.length = 0;

    subscriptions.push(
      controller.events('command-1').subscribe((event) => {
        messages.push(event);
      }),
    );

    await vi.waitFor(() => {
      expect(messages).toHaveLength(1);
    });

    expect(messages[0]).toMatchObject({
      type: 'command.snapshot',
      data: { command: completedCommand },
    });
  });

  it('reconciles queued command events by revision, including equal timestamps', async () => {
    let resolveSnapshot!: (command: CommandState) => void;
    const snapshot = new Promise<CommandState>((resolve) => {
      resolveSnapshot = resolve;
    });
    const repository = Object.create(
      CommandRepository.prototype,
    ) as CommandRepository;

    vi.spyOn(repository, 'findStateById').mockReturnValue(snapshot);

    const eventBus = new ApplicationEventBus();
    const controller = new ApplicationEventsController(eventBus, repository);
    const messages: Array<{ type?: string; data?: unknown }> = [];

    subscriptions.push(
      controller.events('command-1').subscribe((event) => {
        messages.push(event);
      }),
    );

    eventBus.publish({
      type: 'command.progress',
      occurredAt: '2026-09-30T10:00:01.000Z',
      command: commandState(1, 1),
    });
    eventBus.publish({
      type: 'command.progress',
      occurredAt: '2026-09-30T10:00:02.000Z',
      command: commandState(2, 2),
    });
    eventBus.publish({
      type: 'command.progress',
      occurredAt: '2026-09-30T10:00:03.000Z',
      command: commandState(3, 3),
    });

    resolveSnapshot(commandState(2, 2));

    await vi.waitFor(() => {
      expect(messages).toHaveLength(2);
    });

    expect(messages).toMatchObject([
      {
        type: 'command.snapshot',
        data: { command: { current: 2, revision: 2 } },
      },
      {
        type: 'command.progress',
        data: { command: { current: 3, revision: 3 } },
      },
    ]);
  });

  it('cleans up its event-bus listener when the SSE client disconnects', () => {
    const repository = Object.create(
      CommandRepository.prototype,
    ) as CommandRepository;
    const eventBus = new ApplicationEventBus();
    const controller = new ApplicationEventsController(eventBus, repository);
    const messages: unknown[] = [];
    const subscription = controller.events().subscribe((event) => {
      messages.push(event);
    });

    subscription.unsubscribe();
    eventBus.publish({
      type: 'domain.invalidated',
      occurredAt: '2026-09-30T10:00:00.000Z',
      scope: 'imports',
    });

    expect(messages).toEqual([]);
  });
});
