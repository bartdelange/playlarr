import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from '@playlarr/shared-database';

import { HealthController } from './health.controller.js';

import { appConfig } from '../config/app.config.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    DatabaseModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
