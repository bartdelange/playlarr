import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import type { CommandState } from '@playlarr/commands-domain';
import { CommandRepository } from '@playlarr/commands-persistence';

@Controller('commands')
export class CommandController {
  constructor(private readonly commandRepository: CommandRepository) {}

  @Get(':id')
  async command(@Param('id') id: string): Promise<CommandState> {
    const command = await this.commandRepository.findStateById(id);

    if (!command) {
      throw new NotFoundException('Command not found');
    }

    return command;
  }
}
