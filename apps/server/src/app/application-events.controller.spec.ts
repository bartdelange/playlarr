import { CommandRepository } from '@playlarr/commands-persistence';
import { ApplicationEventBus } from '@playlarr/events-server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationEventsController } from './application-events.controller.js';

const completedCommand = {
  id: 'command-1',
  type: 'test.command',
  status: 'completed' as const,
  current: 2,
  total: 2,
  attempts: 1,
  createdAt: '2026-09-30T10:00:00.000Z',
  updatedAt: '2026-09-30T10:00:02.000Z',
  startedAt: '2026-09-30T10:00:01.000Z',
  completedAt: '2026-09-30T10:00:02.000Z',
};

describe('ApplicationEventsController', () => {
  const subscriptions: Array<{ unsubscribe(): void }> = [];

  afterEach(() => {
    for (const subscription of subscriptions) {
      subscription.unsubscribe();
    }

    subscriptions.length = 0;
  });

  it('reconciles a command-scoped connection from persisted current state', async () => {
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
      .events('command-1')
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
