import { join } from 'node:path';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Migrator } from '@mikro-orm/migrations';
import { defineConfig, SqliteDriver } from '@mikro-orm/sqlite';

import { RuntimeMetadataEntity } from './entities/runtime-metadata.entity.js';

const migrationsPath = join(__dirname, 'migrations');

export const createDatabaseConfig = (databasePath: string) =>
  defineConfig({
    driver: SqliteDriver,
    dbName: databasePath,

    entities: [RuntimeMetadataEntity],

    metadataProvider: ReflectMetadataProvider,

    extensions: [Migrator],

    migrations: {
      path: migrationsPath,
      pathTs: migrationsPath,
      transactional: true,
      allOrNothing: true,
      dropTables: false,
      emit: 'ts',
    },
  });
