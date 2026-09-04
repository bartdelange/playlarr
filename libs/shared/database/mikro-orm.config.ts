import 'reflect-metadata';

import { config as loadEnv } from 'dotenv';

import { createDatabaseConfig } from './src/lib/database.config.js';

loadEnv();

const databasePath = process.env['PLAYLARR_DATABASE_PATH'];

if (!databasePath) {
  throw new Error(
    'PLAYLARR_DATABASE_PATH is required for MikroORM CLI commands',
  );
}

export default createDatabaseConfig(databasePath);
