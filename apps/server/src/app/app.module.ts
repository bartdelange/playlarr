import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from '@playlarr/shared-database';
import { CommandsModule } from '@playlarr/commands-server';
import { SampleCommandModule } from '@playlarr/sample-command-server';
import {
  ApplicationCommandEventPublisher,
  ApplicationEventsModule,
} from '@playlarr/events-server';

import { HealthController } from './health.controller.js';

import { appConfig } from '../config/app.config.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    DatabaseModule,
    ApplicationEventsModule,
    CommandsModule.register({
      imports: [ApplicationEventsModule],
      eventPublisher: ApplicationCommandEventPublisher,
    }),
    SampleCommandModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
