export interface Command<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
}

export type NewCommand = Omit<Command, 'id'>;
