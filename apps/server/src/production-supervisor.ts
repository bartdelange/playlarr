import type { ChildProcess } from 'node:child_process';

export type ShutdownSignal = 'SIGINT' | 'SIGTERM';
// This outer safety net must leave the backend's 10-second shutdown policy time to finish first.
export const PRODUCTION_SHUTDOWN_GRACE_MS = 15_000;

interface ManagedProcess {
  readonly name: string;
  readonly child: Pick<ChildProcess, 'kill' | 'once'>;
}

export class ProductionSupervisor {
  private readonly running = new Set<ManagedProcess>();
  private shutdownSignal?: ShutdownSignal;
  private exitCode = 0;
  private forceShutdownTimer?: ReturnType<typeof setTimeout>;
  private completed = false;
  private resolveCompletion?: (exitCode: number) => void;

  readonly completion = new Promise<number>((resolve) => {
    this.resolveCompletion = resolve;
  });

  constructor(
    processes: readonly ManagedProcess[],
    private readonly shutdownGraceMs = PRODUCTION_SHUTDOWN_GRACE_MS,
  ) {
    for (const process of processes) {
      this.running.add(process);
      process.child.once('exit', (code, signal) => {
        this.handleExit(process, code, signal);
      });
      process.child.once('error', () => {
        this.handleStartFailure(process);
      });
    }
  }

  shutdown(signal: ShutdownSignal): void {
    if (this.shutdownSignal) {
      return;
    }

    this.shutdownSignal = signal;

    this.forceShutdownTimer = setTimeout(() => {
      this.forceShutdown();
    }, this.shutdownGraceMs);

    for (const process of this.running) {
      process.child.kill(signal);
    }
  }

  private handleStartFailure(process: ManagedProcess): void {
    if (!this.running.delete(process)) {
      return;
    }

    this.exitCode = 1;
    this.shutdown('SIGTERM');
    this.finishIfStopped();
  }

  private handleExit(
    process: ManagedProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (!this.running.delete(process)) {
      return;
    }

    if (!this.shutdownSignal) {
      this.exitCode = code === 0 && signal === null ? 1 : (code ?? 1);
      this.shutdown('SIGTERM');
    } else if (code !== null && code !== 0) {
      this.exitCode = code;
    }

    this.finishIfStopped();
  }

  private forceShutdown(): void {
    if (this.running.size === 0) {
      return;
    }

    this.exitCode = 1;

    for (const process of this.running) {
      process.child.kill('SIGKILL');
    }
  }

  private finishIfStopped(): void {
    if (this.running.size === 0) {
      this.finish(this.exitCode);
    }
  }

  private finish(exitCode: number): void {
    if (this.completed) {
      return;
    }

    this.completed = true;

    if (this.forceShutdownTimer) {
      clearTimeout(this.forceShutdownTimer);
    }

    this.resolveCompletion?.(exitCode);
  }
}
