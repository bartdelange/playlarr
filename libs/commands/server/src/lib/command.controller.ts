import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import type { CommandState } from '@playlarr/commands-domain';
import { CommandRepository } from '@playlarr/commands-persistence';

@Controller('commands')
export class CommandController {
  constructor(private readonly commandRepository: CommandRepository) {}

  @Get()
  async associated(
    @Query('scope') scopeQuery?: string,
    @Query('entityId') entityIdQuery?: string,
  ): Promise<CommandState[]> {
    const scope = scopeQuery?.trim();
    const entityId = entityIdQuery?.trim();

    if (!scope || !entityId) {
      throw new BadRequestException('scope and entityId are required');
    }

    return this.commandRepository.findStatesByAssociation({
      scope,
      entityId,
    });
  }

  @Get(':id')
  async command(@Param('id') id: string): Promise<CommandState> {
    const command = await this.commandRepository.findStateById(id);

    if (!command) {
      throw new NotFoundException('Command not found');
    }

    return command;
  }
}
