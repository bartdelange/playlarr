import type { CommandState } from '@playlarr/commands-domain';
import { CommandRepository } from '@playlarr/commands-persistence';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationCommandEventPublisher } from './application-command-event.publisher.js';
import { ApplicationEventBus } from './application-event-bus.js';

describe('ApplicationCommandEventPublisher', () => {
  it('loads authoritative state before publishing a command event', async () => {
    const command: CommandState = {
      id: 'command-1',
      type: 'test.command',
      status: 'completed',
      current: 2,
      total: 2,
      attempts: 1,
      revision: 3,
      createdAt: '2026-09-30T10:00:00.000Z',
      updatedAt: '2026-09-30T10:00:02.000Z',
      startedAt: '2026-09-30T10:00:01.000Z',
      completedAt: '2026-09-30T10:00:02.000Z',
    };
    const repository = Object.create(
      CommandRepository.prototype,
    ) as CommandRepository;

    vi.spyOn(repository, 'findStateById').mockResolvedValue(command);

    const eventBus = new ApplicationEventBus();
    const listener = vi.fn();
    const publisher = new ApplicationCommandEventPublisher(
      repository,
      eventBus,
    );

    eventBus.subscribe({ commandId: command.id }, listener);

    await publisher.publish(command.id, 'command.completed');

    expect(listener).toHaveBeenCalledWith({
      type: 'command.completed',
      occurredAt: expect.any(String),
      command,
    });
  });
});
