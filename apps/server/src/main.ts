import 'reflect-metadata';

import { type INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app/app.module.js';

async function bootstrap(): Promise<void> {
  let app: INestApplication | undefined;

  try {
    app = await NestFactory.create(AppModule);

    const config = app.get(ConfigService);
    const logger = new Logger('Bootstrap');

    app.setGlobalPrefix('api');
    app.enableShutdownHooks();

    const host = config.getOrThrow<string>('app.server.host');
    const port = config.getOrThrow<number>('app.server.port');

    await app.listen(port, host);

    logger.log(`Playlarr server listening on http://${host}:${port}`);
  } catch (error) {
    await app?.close();

    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');

  logger.error(
    'Playlarr server failed to start',
    error instanceof Error ? error.stack : String(error),
  );

  process.exit(1);
});
