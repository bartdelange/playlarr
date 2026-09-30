import {
  Global,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ApplicationEventBus } from '@playlarr/events-server';
import { CommandsPersistenceModule } from '@playlarr/commands-persistence';

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
  providers: [ApplicationEventBus, ApplicationEventsLifecycle],
  exports: [ApplicationEventBus],
})
export class ApplicationEventsModule {}
