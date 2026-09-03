import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app/app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const host = config.getOrThrow<string>('app.server.host');
  const port = config.getOrThrow<number>('app.server.port');

  await app.listen(port, host);

  logger.log(`Playlarr server listening on http://${host}:${port}`);
}

void bootstrap();
