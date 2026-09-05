import 'reflect-metadata';

import { createDatabaseConfig } from '@playlarr/shared-database';

const databasePath = process.env['PLAYLARR_DATABASE_PATH'];

if (!databasePath) {
  throw new Error(
    'PLAYLARR_DATABASE_PATH is required for MikroORM CLI commands',
  );
}

const config = createDatabaseConfig(databasePath);

export default {
  ...config,

  baseDir: '../../',

  entities: ['dist/libs/**/persistence/**/*.entity.js'],

  entitiesTs: ['libs/**/persistence/src/**/*.entity.ts'],

  preferTs: true,
};
