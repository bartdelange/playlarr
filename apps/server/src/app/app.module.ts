import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from '@playlarr/shared-database';
import { CommandsModule } from '@playlarr/commands-server';
import { SampleCommandModule } from '@playlarr/sample-command-server';

import { HealthController } from './health.controller.js';

import { appConfig } from '../config/app.config.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    DatabaseModule,
    CommandsModule,
    SampleCommandModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
