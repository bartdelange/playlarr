import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  PRODUCTION_SHUTDOWN_GRACE_MS,
  ProductionSupervisor,
} from './production-supervisor.js';

class FakeChildProcess extends EventEmitter {
  readonly kill = vi.fn(() => true);

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('exit', code, signal);
  }

  failToStart(): void {
    this.emit('error', new Error('spawn failed'));
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
    supervisor.shutdown('SIGINT');

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

  it.each(['server', 'web'] as const)(
    'fails and terminates the sibling after an unexpected %s exit',
    async (exitedName) => {
      const server = new FakeChildProcess();
      const web = new FakeChildProcess();
      const exited = exitedName === 'server' ? server : web;
      const sibling = exitedName === 'server' ? web : server;
      const supervisor = new ProductionSupervisor([
        { name: 'server', child: server },
        { name: 'web', child: web },
      ]);

      exited.exit(0);

      expect(sibling.kill).toHaveBeenCalledWith('SIGTERM');

      sibling.exit(null, 'SIGTERM');

      await expect(supervisor.completion).resolves.toBe(1);
    },
  );

  it('force kills children and fails when graceful shutdown expires', async () => {
    vi.useFakeTimers();

    try {
      const server = new FakeChildProcess();
      const web = new FakeChildProcess();
      const supervisor = new ProductionSupervisor([
        { name: 'server', child: server },
        { name: 'web', child: web },
      ]);

      supervisor.shutdown('SIGTERM');
      await vi.advanceTimersByTimeAsync(10_000);

      expect(server.kill).toHaveBeenCalledOnce();
      expect(web.kill).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(PRODUCTION_SHUTDOWN_GRACE_MS - 10_000);

      expect(server.kill).toHaveBeenLastCalledWith('SIGKILL');
      expect(web.kill).toHaveBeenLastCalledWith('SIGKILL');

      let completed = false;
      void supervisor.completion.then(() => {
        completed = true;
      });
      await Promise.resolve();

      expect(completed).toBe(false);

      server.exit(null, 'SIGKILL');
      await Promise.resolve();

      expect(completed).toBe(false);

      web.exit(null, 'SIGKILL');

      await expect(supervisor.completion).resolves.toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['server', 'web'] as const)(
    'terminates the sibling when %s fails to start',
    async (failedName) => {
      const server = new FakeChildProcess();
      const web = new FakeChildProcess();
      const failed = failedName === 'server' ? server : web;
      const sibling = failedName === 'server' ? web : server;
      const supervisor = new ProductionSupervisor([
        { name: 'server', child: server },
        { name: 'web', child: web },
      ]);

      failed.failToStart();

      expect(sibling.kill).toHaveBeenCalledWith('SIGTERM');

      sibling.exit(null, 'SIGTERM');

      await expect(supervisor.completion).resolves.toBe(1);
    },
  );
});
