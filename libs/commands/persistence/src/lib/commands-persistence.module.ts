import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { CommandEntity } from './command.entity.js';
import { CommandRepository } from './command.repository.js';

@Module({
  imports: [MikroOrmModule.forFeature([CommandEntity])],
  providers: [CommandRepository],
  exports: [MikroOrmModule, CommandRepository],
})
export class CommandsPersistenceModule {}
