import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { AuthSessionEntity } from './auth-session.entity.js';
import { AuthSessionRepository } from './auth-session.repository.js';

@Module({
  imports: [MikroOrmModule.forFeature([AuthSessionEntity])],
  providers: [AuthSessionRepository],
  exports: [AuthSessionRepository],
})
export class AuthPersistenceModule {}
