import { CommandProgress } from './command-progress.js';

export interface CommandHandler<TPayload = unknown> {
  readonly type: string;

  execute(payload: TPayload, progress: CommandProgress): Promise<void>;
}
