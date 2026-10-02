export type CommandEventType =
  | 'command.started'
  | 'command.progress'
  | 'command.completed'
  | 'command.failed';

export interface CommandEventPublisher {
  publish(commandId: string, type: CommandEventType): Promise<void>;
}
