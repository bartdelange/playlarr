import { Module } from '@nestjs/common';
import { CommandsPersistenceModule } from '@playlarr/commands-persistence';

import { CommandController } from './command.controller.js';
import { CommandHandlerRegistry } from './command-handler.registry.js';
import { CommandService } from './command.service.js';
import { CommandRuntimeLifecycle } from './command-runtime-lifecycle.js';
import { CommandWakeSignal } from './command-wake-signal.js';

@Module({
  imports: [CommandsPersistenceModule],
  controllers: [CommandController],
  providers: [
    CommandHandlerRegistry,
    CommandRuntimeLifecycle,
    CommandWakeSignal,
    CommandService,
  ],
  exports: [
    CommandHandlerRegistry,
    CommandRuntimeLifecycle,
    CommandService,
    CommandWakeSignal,
  ],
})
export class CommandServicesModule {}
