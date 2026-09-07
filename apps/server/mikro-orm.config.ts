import { resolve } from 'node:path';

import 'reflect-metadata';

import type { Options } from '@mikro-orm/sqlite';
import { createDatabaseConfig } from '@playlarr/shared-database';

const databasePath = process.env['PLAYLARR_DATABASE_PATH'];

if (!databasePath) {
  throw new Error(
    'PLAYLARR_DATABASE_PATH is required for MikroORM CLI commands',
  );
}

const baseConfig = createDatabaseConfig(databasePath);

const config: Partial<Options> = {
  ...baseConfig,

  baseDir: '../..',
  preferTs: true,

  entities: [...(baseConfig.entities ?? []), 'dist/libs/**/*.entity.js'],

  entitiesTs: ['libs/**/*.entity.ts'],

  migrations: {
    ...baseConfig.migrations,
    pathTs: resolve(
      process.cwd(),
      '../../libs/shared/database/src/lib/migrations',
    ),
  },
};

export default config;
