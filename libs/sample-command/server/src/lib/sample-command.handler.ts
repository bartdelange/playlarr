import { Injectable, Logger } from '@nestjs/common';
import type {
  CommandHandler,
  CommandProgressReporter,
} from '@playlarr/commands-domain';

@Injectable()
export class SampleCommandHandler implements CommandHandler<{ steps: number }> {
  private readonly logger = new Logger(SampleCommandHandler.name);

  readonly type = 'sample.delay';
  readonly retryInterrupted = true;

  async execute(
    payload: { steps: number },
    progress: CommandProgressReporter,
  ): Promise<void> {
    for (let current = 1; current <= payload.steps; current++) {
      this.logger.log(`Executing step ${current} of ${payload.steps}`);
      this.logger.debug(`Payload: ${JSON.stringify(payload)}`);

      await progress.report({
        current,
        total: payload.steps,
        currentItem: `Step ${current}`,
      });
    }
  }
}
