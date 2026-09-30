import type { CommandStatus } from './command-status.js';

export interface CommandState {
  readonly id: string;
  readonly type: string;
  readonly status: CommandStatus;
  readonly current: number;
  readonly total: number;
  readonly currentItem?: string;
  readonly attempts: number;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}
