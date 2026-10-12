import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { AuthSessionEntity } from './auth-session.entity.js';
import { AuthSessionRepository } from './auth-session.repository.js';
import { AuthStateRepository } from './auth-state.repository.js';

@Module({
  imports: [MikroOrmModule.forFeature([AuthSessionEntity])],
  providers: [AuthSessionRepository, AuthStateRepository],
  exports: [AuthSessionRepository, AuthStateRepository],
})
export class AuthPersistenceModule {}
