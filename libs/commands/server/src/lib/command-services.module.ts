import { Module } from '@nestjs/common';
import { CommandsPersistenceModule } from '@playlarr/commands-persistence';

import { CommandController } from './command.controller.js';
import { CommandHandlerRegistry } from './command-handler.registry.js';
import { CommandService } from './command.service.js';
import { CommandWakeSignal } from './command-wake-signal.js';

@Module({
  imports: [CommandsPersistenceModule],
  controllers: [CommandController],
  providers: [CommandHandlerRegistry, CommandWakeSignal, CommandService],
  exports: [CommandHandlerRegistry, CommandService, CommandWakeSignal],
})
export class CommandServicesModule {}
