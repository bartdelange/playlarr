import { Injectable } from '@nestjs/common';
import type { CommandHandler } from '@playlarr/commands-domain';

@Injectable()
export class FailingSampleCommandHandler implements CommandHandler<
  Record<string, never>
> {
  readonly type = 'sample.fail';
  readonly retryInterrupted = false;

  async execute(): Promise<void> {
    throw new Error('Intentional sample failure');
  }
}
