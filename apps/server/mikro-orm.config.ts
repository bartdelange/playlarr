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

  entities: [
    'dist/libs/**/persistence/**/*.entity.js',
    'libs/shared/database/src/lib/entities/**/*.entity.ts',
  ],

  entitiesTs: [
    'libs/**/persistence/src/**/*.entity.ts',
    'libs/shared/database/src/lib/entities/**/*.entity.ts',
  ],
};

export default config;
