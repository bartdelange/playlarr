export type CommandEventType =
  | 'command.started'
  | 'command.progress'
  | 'command.completed'
  | 'command.failed';

export abstract class CommandEventPublisher {
  abstract publish(commandId: string, type: CommandEventType): Promise<void>;
}
