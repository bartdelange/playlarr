import { describe, expect, it, vi } from 'vitest';

import { CommandRuntimeLifecycle } from './command-runtime-lifecycle.js';
import { CommandService } from './command.service.js';
import { CommandWakeSignal } from './command-wake-signal.js';

describe('CommandService', () => {
  it('rejects new durable work after shutdown begins', async () => {
    const repository = {
      create: vi.fn(),
    };
    const lifecycle = new CommandRuntimeLifecycle();
    const service = new CommandService(
      repository as never,
      new CommandWakeSignal(),
      lifecycle,
    );

    lifecycle.stopAcceptingWork();

    await expect(service.enqueue('test.command', {})).rejects.toMatchObject({
      status: 503,
    });
    expect(repository.create).not.toHaveBeenCalled();
  });
});
