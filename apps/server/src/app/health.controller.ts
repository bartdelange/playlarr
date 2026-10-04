import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { CommandRuntimeLifecycle } from '@playlarr/commands-server';

@Controller('health')
export class HealthController {
  constructor(private readonly lifecycle: CommandRuntimeLifecycle) {}

  @Get()
  getHealth() {
    if (!this.lifecycle.isAcceptingWork()) {
      throw new ServiceUnavailableException({ status: 'stopping' });
    }

    return {
      status: 'ok',
    };
  }
}
