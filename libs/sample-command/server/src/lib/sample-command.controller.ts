import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { CommandService } from '@playlarr/commands-server';

interface StartSampleCommandBody {
  steps: number;
}

interface StartSampleCommandResponse {
  commandId: string;
}

@Controller('sample-command')
export class SampleCommandController {
  constructor(private readonly commands: CommandService) {}

  @Post()
  async execute(
    @Body() body: StartSampleCommandBody,
  ): Promise<StartSampleCommandResponse> {
    if (!Number.isInteger(body.steps) || body.steps <= 0) {
      throw new BadRequestException('steps must be a positive integer');
    }

    const commandId = await this.commands.enqueue('sample.delay', {
      steps: body.steps,
    });

    return { commandId };
  }
}
