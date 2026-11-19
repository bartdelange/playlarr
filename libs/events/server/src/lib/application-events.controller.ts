import {
  BadRequestException,
  Controller,
  type MessageEvent,
  Query,
  Sse,
} from '@nestjs/common';
import type { CommandState } from '@playlarr/commands-domain';
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
  readonly command: CommandState;
}

const message = (
  event: ApplicationEvent | CommandSnapshotEvent,
): MessageEvent => ({
  type: event.type,
  data: event,
});

const optionalQuery = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();

  return trimmed || undefined;
};

const occurredAfterSnapshot = (
  event: ApplicationEvent,
  snapshot: CommandSnapshotEvent['command'],
): boolean =>
  event.type === 'domain.invalidated' ||
  event.command.revision > snapshot.revision;

const occurredAfterSnapshots = (
  event: ApplicationEvent,
  snapshots: readonly CommandState[],
): boolean => {
  if (event.type === 'domain.invalidated') {
    return true;
  }

  const snapshot = snapshots.find((command) => command.id === event.command.id);

  return snapshot === undefined || event.command.revision > snapshot.revision;
};

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
    @Query('entityId') entityIdQuery?: string,
  ): Observable<MessageEvent> {
    const commandId = optionalQuery(commandIdQuery);
    const scope = optionalQuery(scopeQuery);
    const entityId = optionalQuery(entityIdQuery);

    if (
      commandId !== undefined &&
      (scope !== undefined || entityId !== undefined)
    ) {
      throw new BadRequestException(
        'commandId and scope filters cannot be combined',
      );
    }

    if (entityId !== undefined && scope === undefined) {
      throw new BadRequestException('entityId requires a scope filter');
    }

    const filter: ApplicationEventFilter = {
      ...(commandId === undefined ? {} : { commandId }),
      ...(scope === undefined ? {} : { scope }),
      ...(entityId === undefined ? {} : { entityId }),
    };

    return new Observable<MessageEvent>((subscriber) => {
      const pending: ApplicationEvent[] = [];
      const association =
        filter.scope !== undefined && filter.entityId !== undefined
          ? { scope: filter.scope, entityId: filter.entityId }
          : undefined;
      let initialized =
        filter.commandId === undefined && association === undefined;
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
      } else if (association !== undefined) {
        void this.commandRepository
          .findStatesByAssociation(association)
          .then((commands) => {
            if (!connected) {
              return;
            }

            for (const command of commands) {
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
              if (occurredAfterSnapshots(event, commands)) {
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
