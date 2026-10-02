import { Injectable } from '@nestjs/common';
import {
  type CommandEventPublisher,
  type CommandEventType,
} from '@playlarr/commands-domain';
import { CommandRepository } from '@playlarr/commands-persistence';

import { ApplicationEventBus } from './application-event-bus.js';

@Injectable()
export class ApplicationCommandEventPublisher implements CommandEventPublisher {
  constructor(
    private readonly commandRepository: CommandRepository,
    private readonly eventBus: ApplicationEventBus,
  ) {}

  async publish(commandId: string, type: CommandEventType): Promise<void> {
    const command = await this.commandRepository.findStateById(commandId);

    if (!command) {
      return;
    }

    this.eventBus.publish({
      type,
      occurredAt: new Date().toISOString(),
      command,
    });
  }
}
