import { Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { CommandsPersistenceModule } from '@playlarr/commands-persistence';

import { ApplicationCommandEventPublisher } from './application-command-event.publisher.js';
import { ApplicationEventBus } from './application-event-bus.js';
import { ApplicationEventsController } from './application-events.controller.js';

@Injectable()
class ApplicationEventsLifecycle implements OnApplicationShutdown {
  constructor(private readonly eventBus: ApplicationEventBus) {}

  onApplicationShutdown(): void {
    this.eventBus.close();
  }
}

@Module({
  imports: [CommandsPersistenceModule],
  controllers: [ApplicationEventsController],
  providers: [
    ApplicationEventBus,
    ApplicationCommandEventPublisher,
    ApplicationEventsLifecycle,
  ],
  exports: [ApplicationCommandEventPublisher, ApplicationEventBus],
})
export class ApplicationEventsModule {}
