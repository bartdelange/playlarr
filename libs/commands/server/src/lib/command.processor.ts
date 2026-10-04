import {
  Injectable,
  Inject,
  Logger,
  OnApplicationBootstrap,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import { map, merge, Subscription, timer } from 'rxjs';
import { CommandRepository } from '@playlarr/commands-persistence';
import { CommandHandlerRegistry } from './command-handler.registry.js';
import { CommandWakeSignal } from './command-wake-signal.js';
import {
  type CommandEventPublisher,
  type CommandEventType,
  type CommandProgressReporter,
} from '@playlarr/commands-domain';
import { COMMAND_EVENT_PUBLISHER } from './command-event-publisher.token.js';
import { CommandRuntimeLifecycle } from './command-runtime-lifecycle.js';
import {
  CRITICAL_FAILURE_HANDLER,
  type CriticalFailureHandler,
} from './critical-failure.handler.js';

const FALLBACK_INTERVAL_MS = 10_000;
export const COMMAND_SHUTDOWN_GRACE_MS = 10_000;

@Injectable()
export class CommandProcessor
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private subscription?: Subscription;
  private processingPromise?: Promise<void>;
  private shutdownPromise?: Promise<void>;
  private stopping = false;
  private readonly fallbackIntervalMs = FALLBACK_INTERVAL_MS;
  private readonly logger = new Logger(CommandProcessor.name);

  constructor(
    private readonly repository: CommandRepository,
    private readonly registry: CommandHandlerRegistry,
    private readonly wakeSignal: CommandWakeSignal,
    @Inject(COMMAND_EVENT_PUBLISHER)
    private readonly eventPublisher: CommandEventPublisher,
    private readonly lifecycle: CommandRuntimeLifecycle,
    @Inject(CRITICAL_FAILURE_HANDLER)
    private readonly criticalFailureHandler: CriticalFailureHandler,
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

  beforeApplicationShutdown(): Promise<void> {
    this.shutdownPromise ??= this.stop();

    return this.shutdownPromise;
  }

  private async stop(): Promise<void> {
    if (this.stopping) {
      return;
    }

    this.stopping = true;
    this.lifecycle.stopAcceptingWork();
    this.subscription?.unsubscribe();

    const processingPromise = this.processingPromise;

    if (!processingPromise) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        processingPromise,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(
              new Error(
                `Command processing did not stop within ${COMMAND_SHUTDOWN_GRACE_MS}ms`,
              ),
            );
          }, COMMAND_SHUTDOWN_GRACE_MS);
        }),
      ]);
    } catch (error) {
      this.criticalFailureHandler.forceTerminate(error);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private startProcessing(): void {
    if (this.processingPromise || this.stopping) {
      return;
    }

    this.processingPromise = this.processAvailable()
      .catch((error: unknown) => {
        this.lifecycle.stopAcceptingWork();
        this.criticalFailureHandler.terminate(error);
      })
      .finally(() => {
        this.processingPromise = undefined;
      });
  }

  private async processAvailable(): Promise<void> {
    while (!this.stopping) {
      const command = await this.repository.claimNext();

      if (!command) {
        return;
      }

      if (this.stopping) {
        await this.repository.releaseUnstartedClaim(command.id);

        return;
      }

      await this.execute(command);
    }
  }

  async execute(command: {
    id: string;
    type: string;
    payloadJson: unknown;
  }): Promise<void> {
    await this.publishCommandEvent(command.id, 'command.started');

    const handler = this.registry.get(command.type);

    if (!handler) {
      await this.repository.fail(
        command.id,
        `Unsupported command type: ${command.type}`,
      );
      await this.publishCommandEvent(command.id, 'command.failed');

      return;
    }

    const progress: CommandProgressReporter = {
      report: async ({ current, total, currentItem }) => {
        await this.repository.updateProgress(
          command.id,
          current,
          total,
          currentItem,
        );
        await this.publishCommandEvent(command.id, 'command.progress');
      },
    };

    try {
      await handler.execute(command.payloadJson, progress);
      await this.repository.complete(command.id);
      await this.publishCommandEvent(command.id, 'command.completed');
    } catch (error) {
      await this.repository.fail(
        command.id,
        error instanceof Error ? error.message : String(error),
      );
      await this.publishCommandEvent(command.id, 'command.failed');
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
        await this.publishCommandEvent(command.id, 'command.failed');

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
      await this.publishCommandEvent(command.id, 'command.failed');
    }
  }

  private async publishCommandEvent(
    id: string,
    type: CommandEventType,
  ): Promise<void> {
    try {
      await this.eventPublisher.publish(id, type);
    } catch (error) {
      // Notification failures must not change authoritative command execution.
      this.logger.warn(
        `Failed to publish ${type} for command ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
