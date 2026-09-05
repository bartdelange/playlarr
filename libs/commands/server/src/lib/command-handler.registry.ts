import { Injectable } from '@nestjs/common';
import type { CommandHandler } from '@playlarr/commands-domain';

@Injectable()
export class CommandHandlerRegistry {
  private readonly handlers = new Map<string, CommandHandler>();

  register(handler: CommandHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(
        `Command handler already registered for "${handler.type}"`,
      );
    }

    this.handlers.set(handler.type, handler);
  }

  get(type: string): CommandHandler | undefined {
    return this.handlers.get(type);
  }
}
