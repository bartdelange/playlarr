import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { map, merge, Subscription, timer } from 'rxjs';
import { CommandRepository } from '@playlarr/commands-persistence';
import { CommandHandlerRegistry } from './command-handler.registry.js';
import { CommandWakeSignal } from './command-wake-signal.js';
import { CommandProgressReporter } from '@playlarr/commands-domain';

const FALLBACK_INTERVAL_MS = 10_000;

@Injectable()
export class CommandProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private subscription?: Subscription;
  private processingPromise?: Promise<void>;
  private processing = false;
  private stopping = false;
  private readonly fallbackIntervalMs = FALLBACK_INTERVAL_MS;

  constructor(
    private readonly repository: CommandRepository,
    private readonly registry: CommandHandlerRegistry,
    private readonly wakeSignal: CommandWakeSignal,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.recoverInterrupted();

    this.subscription = merge(
      this.wakeSignal.wake$,
      timer(0, this.fallbackIntervalMs).pipe(map(() => undefined)),
    ).subscribe(() => {
      this.startProcessing();
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.subscription?.unsubscribe();

    await this.processingPromise;
  }

  private startProcessing(): void {
    if (this.processing || this.stopping) {
      return;
    }

    this.processingPromise = this.processAvailable().finally(() => {
      this.processingPromise = undefined;
    });
  }

  private async processAvailable(): Promise<void> {
    if (this.processing || this.stopping) {
      return;
    }

    this.processing = true;

    try {
      while (!this.stopping) {
        const command = await this.repository.claimNext();

        if (!command) {
          return;
        }

        await this.execute(command);
      }
    } finally {
      this.processing = false;
    }
  }

  async execute(command: {
    id: string;
    type: string;
    payloadJson: unknown;
  }): Promise<void> {
    const handler = this.registry.get(command.type);

    if (!handler) {
      await this.repository.fail(
        command.id,
        `Unsupported command type: ${command.type}`,
      );

      return;
    }

    const progress: CommandProgressReporter = {
      report: ({ current, total, currentItem }) =>
        this.repository.updateProgress(command.id, current, total, currentItem),
    };

    try {
      await handler.execute(command.payloadJson, progress);
      await this.repository.complete(command.id);
    } catch (error) {
      await this.repository.fail(
        command.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async recoverInterrupted(): Promise<void> {
    const commands = await this.repository.findRunning();

    for (const command of commands) {
      const handler = this.registry.get(command.type);

      if (!handler) {
        await this.repository.fail(
          command.id,
          `Unsupported command type: ${command.type}`,
        );

        continue;
      }

      if (handler.retryInterrupted) {
        await this.repository.requeue(command.id);
        continue;
      }

      await this.repository.fail(
        command.id,
        'Command interrupted by application restart',
      );
    }
  }
}
