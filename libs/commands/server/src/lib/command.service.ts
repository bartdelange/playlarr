import { Injectable } from '@nestjs/common';
import { CommandRepository } from '@playlarr/commands-persistence';
import { CommandWakeSignal } from './command-wake-signal.js';

@Injectable()
export class CommandService {
  constructor(
    private readonly repository: CommandRepository,
    private readonly wakeSignal: CommandWakeSignal,
  ) {}

  async enqueue<TPayload>(type: string, payload: TPayload): Promise<string> {
    const command = await this.repository.create(type, payload);

    this.wakeSignal.wake();

    return command.id;
  }
}
