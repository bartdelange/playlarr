import { Injectable } from '@nestjs/common';
import { CommandRepository } from '@playlarr/commands-persistence';
import { CommandWakeSignal } from './command-wake-signal.js';
import { CommandRuntimeLifecycle } from './command-runtime-lifecycle.js';

@Injectable()
export class CommandService {
  constructor(
    private readonly repository: CommandRepository,
    private readonly wakeSignal: CommandWakeSignal,
    private readonly lifecycle: CommandRuntimeLifecycle,
  ) {}

  async enqueue<TPayload>(type: string, payload: TPayload): Promise<string> {
    this.lifecycle.assertAcceptingWork();

    const command = await this.repository.create(type, payload);

    this.wakeSignal.wake();

    return command.id;
  }
}
