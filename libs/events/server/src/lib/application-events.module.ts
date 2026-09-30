import {
  Global,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CommandEventPublisher } from '@playlarr/commands-domain';
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

@Global()
@Module({
  imports: [CommandsPersistenceModule],
  controllers: [ApplicationEventsController],
  providers: [
    ApplicationEventBus,
    ApplicationCommandEventPublisher,
    {
      provide: CommandEventPublisher,
      useExisting: ApplicationCommandEventPublisher,
    },
    ApplicationEventsLifecycle,
  ],
  exports: [ApplicationEventBus, CommandEventPublisher],
})
export class ApplicationEventsModule {}
