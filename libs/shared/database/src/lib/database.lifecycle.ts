import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { SqliteDriver } from '@mikro-orm/sqlite';

@Injectable()
export class DatabaseLifecycle implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseLifecycle.name);

  constructor(private readonly orm: MikroORM<SqliteDriver>) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Configuring SQLite');

    const connection = this.orm.em.getConnection();

    await connection.execute('PRAGMA foreign_keys = ON');
    await connection.execute('PRAGMA journal_mode = WAL');
    await connection.execute('PRAGMA busy_timeout = 5000');

    this.logger.log('Running pending database migrations');

    await this.orm.migrator.up();

    this.logger.log('Database ready');
  }
}
