import {
  BadRequestException,
  Controller,
  type MessageEvent,
  Query,
  Sse,
} from '@nestjs/common';
import { CommandRepository } from '@playlarr/commands-persistence';
import { Observable } from 'rxjs';

import { ApplicationEventBus } from './application-event-bus.js';
import type {
  ApplicationEvent,
  ApplicationEventFilter,
} from './application-event.js';

interface CommandSnapshotEvent {
  readonly type: 'command.snapshot';
  readonly occurredAt: string;
  readonly command: NonNullable<
    Awaited<ReturnType<CommandRepository['findStateById']>>
  >;
}

const message = (
  event: ApplicationEvent | CommandSnapshotEvent,
): MessageEvent => ({
  type: event.type,
  data: event,
});

const optionalQuery = (value: string | undefined): string | undefined =>
  value && value.trim().length > 0 ? value : undefined;

const occurredAfterSnapshot = (
  event: ApplicationEvent,
  snapshot: CommandSnapshotEvent['command'],
): boolean =>
  event.type === 'domain.invalidated' ||
  event.command.revision > snapshot.revision;

@Controller()
export class ApplicationEventsController {
  constructor(
    private readonly eventBus: ApplicationEventBus,
    private readonly commandRepository: CommandRepository,
  ) {}

  @Sse('events')
  events(
    @Query('commandId') commandIdQuery?: string,
    @Query('scope') scopeQuery?: string,
  ): Observable<MessageEvent> {
    const commandId = optionalQuery(commandIdQuery);
    const scope = optionalQuery(scopeQuery);

    if (commandId !== undefined && scope !== undefined) {
      throw new BadRequestException(
        'commandId and scope filters cannot be combined',
      );
    }

    const filter: ApplicationEventFilter = {
      ...(commandId === undefined ? {} : { commandId }),
      ...(scope === undefined ? {} : { scope }),
    };

    return new Observable<MessageEvent>((subscriber) => {
      const pending: ApplicationEvent[] = [];
      let initialized = filter.commandId === undefined;
      let connected = true;

      const unsubscribe = this.eventBus.subscribe(filter, (event) => {
        if (initialized) {
          subscriber.next(message(event));
        } else {
          pending.push(event);
        }
      });

      if (filter.commandId !== undefined) {
        void this.commandRepository
          .findStateById(filter.commandId)
          .then((command) => {
            if (!connected) {
              return;
            }

            if (command) {
              subscriber.next(
                message({
                  type: 'command.snapshot',
                  occurredAt: new Date().toISOString(),
                  command,
                }),
              );
            }

            initialized = true;

            for (const event of pending) {
              if (!command || occurredAfterSnapshot(event, command)) {
                subscriber.next(message(event));
              }
            }

            pending.length = 0;
          })
          .catch((error: unknown) => {
            if (connected) {
              subscriber.error(error);
            }
          });
      }

      return () => {
        connected = false;
        unsubscribe();
      };
    });
  }
}
