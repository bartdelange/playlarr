import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { ProductionSupervisor } from './production-supervisor.js';

class FakeChildProcess extends EventEmitter {
  readonly kill = vi.fn(() => true);

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('exit', code, signal);
  }
}

describe('ProductionSupervisor', () => {
  it('forwards shutdown signals to both application processes once', async () => {
    const server = new FakeChildProcess();
    const web = new FakeChildProcess();
    const supervisor = new ProductionSupervisor([
      { name: 'server', child: server },
      { name: 'web', child: web },
    ]);

    supervisor.shutdown('SIGTERM');
    supervisor.shutdown('SIGTERM');

    expect(server.kill).toHaveBeenCalledOnce();
    expect(server.kill).toHaveBeenCalledWith('SIGTERM');
    expect(web.kill).toHaveBeenCalledOnce();
    expect(web.kill).toHaveBeenCalledWith('SIGTERM');

    server.exit(null, 'SIGTERM');
    web.exit(null, 'SIGTERM');

    await expect(supervisor.completion).resolves.toBe(0);
  });

  it('terminates the sibling and fails when an application exits', async () => {
    const server = new FakeChildProcess();
    const web = new FakeChildProcess();
    const supervisor = new ProductionSupervisor([
      { name: 'server', child: server },
      { name: 'web', child: web },
    ]);

    server.exit(1);

    expect(web.kill).toHaveBeenCalledWith('SIGTERM');

    web.exit(null, 'SIGTERM');

    await expect(supervisor.completion).resolves.toBe(1);
  });
});
