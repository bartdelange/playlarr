import type { CommandProgressReporter } from './command-progress.js';

export interface CommandHandler<TPayload = unknown> {
  readonly type: string;
  readonly retryInterrupted: boolean;

  execute(payload: TPayload, progress: CommandProgressReporter): Promise<void>;
}
