import { Module } from '@nestjs/common';
import { CommandServicesModule } from '@playlarr/commands-server';

import { FailingSampleCommandHandler } from './failing-sample-command.handler.js';
import { SampleCommandController } from './sample-command.controller.js';
import { SampleCommandHandler } from './sample-command.handler.js';
import { SampleCommandRegistration } from './sample-command.registration.js';

@Module({
  imports: [CommandServicesModule],
  controllers: [SampleCommandController],
  providers: [
    SampleCommandHandler,
    FailingSampleCommandHandler,
    SampleCommandRegistration,
  ],
})
export class SampleCommandModule {}
