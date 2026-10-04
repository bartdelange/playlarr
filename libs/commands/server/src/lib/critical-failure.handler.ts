import { Injectable, Logger } from '@nestjs/common';

export const CRITICAL_FAILURE_HANDLER = Symbol('CRITICAL_FAILURE_HANDLER');

export interface CriticalFailureHandler {
  terminate(error: unknown): void;
}

@Injectable()
export class ProcessCriticalFailureHandler implements CriticalFailureHandler {
  private terminating = false;
  private readonly logger = new Logger(ProcessCriticalFailureHandler.name);

  terminate(error: unknown): void {
    if (this.terminating) {
      return;
    }

    this.terminating = true;
    process.exitCode = 1;

    this.logger.error(
      'A critical backend component failed; shutting down Playlarr',
      error instanceof Error ? error.stack : String(error),
    );

    process.kill(process.pid, 'SIGTERM');
  }
}
