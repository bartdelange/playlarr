import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
  type Type,
} from '@nestjs/common';
import type { CommandEventPublisher } from '@playlarr/commands-domain';
import { CommandsPersistenceModule } from '@playlarr/commands-persistence';

import { COMMAND_EVENT_PUBLISHER } from './command-event-publisher.token.js';
import { CommandProcessor } from './command.processor.js';
import { CommandServicesModule } from './command-services.module.js';
import {
  CRITICAL_FAILURE_HANDLER,
  ProcessCriticalFailureHandler,
} from './critical-failure.handler.js';

interface CommandsModuleOptions {
  readonly imports: NonNullable<ModuleMetadata['imports']>;
  readonly eventPublisher: Type<CommandEventPublisher>;
}

@Module({
  imports: [CommandServicesModule, CommandsPersistenceModule],
})
export class CommandsModule {
  static register(options: CommandsModuleOptions): DynamicModule {
    return {
      module: CommandsModule,
      imports: [...options.imports],
      exports: [CommandServicesModule],
      providers: [
        ProcessCriticalFailureHandler,
        {
          provide: CRITICAL_FAILURE_HANDLER,
          useExisting: ProcessCriticalFailureHandler,
        },
        {
          provide: COMMAND_EVENT_PUBLISHER,
          useExisting: options.eventPublisher,
        },
        CommandProcessor,
      ],
    };
  }
}
