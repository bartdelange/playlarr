import {
  Global,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CommandsPersistenceModule } from '@playlarr/commands-persistence';
import { COMMAND_EVENT_PUBLISHER } from '@playlarr/commands-server';

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

@Global()
@Module({
  imports: [CommandsPersistenceModule],
  controllers: [ApplicationEventsController],
  providers: [
    ApplicationEventBus,
    ApplicationCommandEventPublisher,
    {
      provide: COMMAND_EVENT_PUBLISHER,
      useExisting: ApplicationCommandEventPublisher,
    },
    ApplicationEventsLifecycle,
  ],
  exports: [ApplicationEventBus, COMMAND_EVENT_PUBLISHER],
})
export class ApplicationEventsModule {}
