import { Injectable } from '@nestjs/common';
import {
  CommandHandler,
  CommandProgressReporter,
} from '@playlarr/commands-domain';

@Injectable()
export class SampleCommandHandler implements CommandHandler<{ steps: number }> {
  readonly type = 'sample.delay';
  readonly retryInterrupted = true;

  async execute(
    payload: { steps: number },
    progress: CommandProgressReporter,
  ): Promise<void> {
    for (let current = 1; current <= payload.steps; current++) {
      await progress.report({
        current,
        total: payload.steps,
        currentItem: `Step ${current}`,
      });
    }
  }
}
