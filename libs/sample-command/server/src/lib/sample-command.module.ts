import { Module } from '@nestjs/common';
import { CommandsModule } from '@playlarr/commands-server';

import { FailingSampleCommandHandler } from './failing-sample-command.handler.js';
import { SampleCommandHandler } from './sample-command.handler.js';
import { SampleCommandRegistration } from './sample-command.registration.js';

@Module({
  imports: [CommandsModule],
  providers: [
    SampleCommandHandler,
    FailingSampleCommandHandler,
    SampleCommandRegistration,
  ],
})
export class SampleCommandModule {}
