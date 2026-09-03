import { join } from 'node:path';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Migrator } from '@mikro-orm/migrations';
import { defineConfig, SqliteDriver } from '@mikro-orm/sqlite';

import { RuntimeMetadataEntity } from './entities/runtime-metadata.entity';

const migrationsPath = join(__dirname, 'migrations');

export const createDatabaseConfig = (databasePath: string) =>
  defineConfig({
    driver: SqliteDriver,
    dbName: databasePath,

    metadataProvider: ReflectMetadataProvider,

    entities: [RuntimeMetadataEntity],

    extensions: [Migrator],

    migrations: {
      path: migrationsPath,
      pathTs: 'libs/shared/database/src/lib/migrations',
      transactional: true,
      allOrNothing: true,
      dropTables: false,
      emit: 'ts',
    },
  });
