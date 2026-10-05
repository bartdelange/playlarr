import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthPersistenceModule } from '@playlarr/auth-persistence';
import { SettingsPersistenceModule } from '@playlarr/settings-persistence';

import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [AuthPersistenceModule, SettingsPersistenceModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AuthModule {}
