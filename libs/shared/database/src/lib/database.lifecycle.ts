import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { SqliteDriver } from '@mikro-orm/sqlite';
import { configureSqlite } from './database.bootstrap';

@Injectable()
export class DatabaseLifecycle implements OnModuleInit {
  private readonly logger = new Logger(DatabaseLifecycle.name);

  constructor(private readonly orm: MikroORM<SqliteDriver>) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Configuring SQLite');

    await configureSqlite(this.orm);

    this.logger.log('Running pending database migrations');

    await this.orm.migrator.up();

    this.logger.log('Database ready');
  }
}
