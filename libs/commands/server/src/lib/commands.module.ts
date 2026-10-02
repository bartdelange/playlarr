import { Module } from '@nestjs/common';
import { CommandsPersistenceModule } from '@playlarr/commands-persistence';
import { CommandHandlerRegistry } from './command-handler.registry.js';
import { CommandWakeSignal } from './command-wake-signal.js';
import { CommandService } from './command.service.js';
import { CommandProcessor } from './command.processor.js';
import { CommandController } from './command.controller.js';

@Module({
  imports: [CommandsPersistenceModule],
  controllers: [CommandController],
  providers: [
    CommandHandlerRegistry,
    CommandWakeSignal,
    CommandService,
    CommandProcessor,
  ],
  exports: [CommandHandlerRegistry, CommandService],
})
export class CommandsModule {}
