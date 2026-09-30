import type { CommandState } from '@playlarr/commands-domain';

export type CommandEventType =
  | 'command.started'
  | 'command.progress'
  | 'command.completed'
  | 'command.failed';

export interface CommandEvent {
  readonly type: CommandEventType;
  readonly occurredAt: string;
  readonly command: CommandState;
}

export interface DomainInvalidatedEvent {
  readonly type: 'domain.invalidated';
  readonly occurredAt: string;
  readonly scope: string;
  readonly entityId?: string;
}

export type ApplicationEvent = CommandEvent | DomainInvalidatedEvent;

export interface ApplicationEventFilter {
  readonly commandId?: string;
  readonly scope?: string;
}
