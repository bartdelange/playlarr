import type { CommandState } from '@playlarr/commands-domain';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationEventBus } from './application-event-bus.js';

const command = (id: string): CommandState => ({
  id,
  type: 'test.command',
  status: 'running',
  current: 1,
  total: 2,
  attempts: 1,
  createdAt: '2026-09-30T10:00:00.000Z',
  updatedAt: '2026-09-30T10:00:01.000Z',
  startedAt: '2026-09-30T10:00:01.000Z',
});

describe('ApplicationEventBus', () => {
  it('delivers events to matching command and domain subscribers', () => {
    const bus = new ApplicationEventBus();
    const commandListener = vi.fn();
    const domainListener = vi.fn();

    bus.subscribe({ commandId: 'command-1' }, commandListener);
    bus.subscribe({ scope: 'imports' }, domainListener);

    bus.publish({
      type: 'command.progress',
      occurredAt: '2026-09-30T10:00:01.000Z',
      command: command('command-1'),
    });
    bus.publish({
      type: 'command.progress',
      occurredAt: '2026-09-30T10:00:01.000Z',
      command: command('command-2'),
    });
    bus.publish({
      type: 'domain.invalidated',
      occurredAt: '2026-09-30T10:00:02.000Z',
      scope: 'imports',
      entityId: 'import-1',
    });

    expect(commandListener).toHaveBeenCalledOnce();
    expect(domainListener).toHaveBeenCalledOnce();
  });

  it('removes a subscription when disconnected', () => {
    const bus = new ApplicationEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe({}, listener);

    unsubscribe();
    bus.publish({
      type: 'command.progress',
      occurredAt: '2026-09-30T10:00:01.000Z',
      command: command('command-1'),
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('isolates command execution from failing observers', () => {
    const bus = new ApplicationEventBus();

    bus.subscribe({}, () => {
      throw new Error('Disconnected observer');
    });

    expect(() =>
      bus.publish({
        type: 'command.completed',
        occurredAt: '2026-09-30T10:00:02.000Z',
        command: command('command-1'),
      }),
    ).not.toThrow();
  });
});
