import { Injectable, OnModuleInit } from '@nestjs/common';
import { CommandHandlerRegistry } from '@playlarr/commands-server';

import { FailingSampleCommandHandler } from './failing-sample-command.handler.js';
import { SampleCommandHandler } from './sample-command.handler.js';

@Injectable()
export class SampleCommandRegistration implements OnModuleInit {
  constructor(
    private readonly registry: CommandHandlerRegistry,
    private readonly sampleHandler: SampleCommandHandler,
    private readonly failingHandler: FailingSampleCommandHandler,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.sampleHandler);
    this.registry.register(this.failingHandler);
  }
}
