import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { SqliteDriver } from '@mikro-orm/sqlite';

import { createDatabaseConfig } from './database.config';
import { DatabaseLifecycle } from './database.lifecycle';

@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      driver: SqliteDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databasePath = config.getOrThrow<string>('app.database.path');

        return createDatabaseConfig(databasePath);
      },
    }),
  ],
  providers: [DatabaseLifecycle],
})
export class DatabaseModule {}
