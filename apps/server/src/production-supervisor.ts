import type { ChildProcess } from 'node:child_process';

export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

interface ManagedProcess {
  readonly name: string;
  readonly child: Pick<ChildProcess, 'kill' | 'once'>;
}

export class ProductionSupervisor {
  private readonly running = new Set<ManagedProcess>();
  private shutdownSignal?: ShutdownSignal;
  private exitCode = 0;
  private resolveCompletion?: (exitCode: number) => void;

  readonly completion = new Promise<number>((resolve) => {
    this.resolveCompletion = resolve;
  });

  constructor(processes: readonly ManagedProcess[]) {
    for (const process of processes) {
      this.running.add(process);
      process.child.once('exit', (code, signal) => {
        this.handleExit(process, code, signal);
      });
    }
  }

  shutdown(signal: ShutdownSignal): void {
    if (this.shutdownSignal) {
      return;
    }

    this.shutdownSignal = signal;

    for (const process of this.running) {
      process.child.kill(signal);
    }
  }

  private handleExit(
    process: ManagedProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    this.running.delete(process);

    if (!this.shutdownSignal) {
      this.exitCode = code === 0 && signal === null ? 1 : (code ?? 1);
      this.shutdown('SIGTERM');
    } else if (code !== null && code !== 0) {
      this.exitCode = code;
    }

    if (this.running.size === 0) {
      this.resolveCompletion?.(this.exitCode);
    }
  }
}
