import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { AuthConfigurationEntity } from './auth-configuration.entity.js';
import { AuthConfigurationRepository } from './auth-configuration.repository.js';
import { AuthSessionEntity } from './auth-session.entity.js';
import { AuthSessionRepository } from './auth-session.repository.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([AuthConfigurationEntity, AuthSessionEntity]),
  ],
  providers: [AuthConfigurationRepository, AuthSessionRepository],
  exports: [AuthConfigurationRepository, AuthSessionRepository],
})
export class AuthPersistenceModule {}
