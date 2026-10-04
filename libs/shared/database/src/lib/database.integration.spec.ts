import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MikroORM } from '@mikro-orm/core';
import { Migration } from '@mikro-orm/migrations';
import type { SqliteDriver } from '@mikro-orm/sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabaseConfig } from './database.config.js';
import { DatabaseLifecycle } from './database.lifecycle.js';

class DeliberatelyFailingMigration extends Migration {
  override name = 'Migration99999999999999';

  override up(): void {
    this.addSql(
      'create table migration_partial_change (id integer primary key)',
    );
    this.addSql('insert into deliberately_missing_table (id) values (1)');
  }
}

describe('database integration', () => {
  let directory: string | undefined;
  let orm: MikroORM<SqliteDriver> | undefined;

  afterEach(async () => {
    await orm?.close(true);

    if (directory) {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }

    orm = undefined;
    directory = undefined;
  });

  async function createDatabase() {
    directory = await mkdtemp(join(tmpdir(), 'playlarr-database-'));

    const path = join(directory, 'playlarr.db');

    orm = await MikroORM.init<SqliteDriver>(createDatabaseConfig(path));

    const lifecycle = new DatabaseLifecycle(orm);

    await lifecycle.onModuleInit();

    return {
      path,
      orm,
    };
  }

  it('creates a fresh database at the current schema version', async () => {
    const database = await createDatabase();

    await expect(access(database.path)).resolves.toBeUndefined();

    const tables = await database.orm.em.getConnection().execute(
      `select name from sqlite_master
       where type = 'table' and name in ('_runtime_metadata', 'commands')
       order by name`,
    );
    const pending = await database.orm.migrator.getPending();

    expect(tables).toEqual([
      { name: '_runtime_metadata' },
      { name: 'commands' },
    ]);
    expect(pending).toEqual([]);
  });

  it('configures the required SQLite pragmas', async () => {
    const database = await createDatabase();

    const connection = database.orm.em.getConnection();

    const foreignKeys = await connection.execute('PRAGMA foreign_keys');

    const journalMode = await connection.execute('PRAGMA journal_mode');

    const busyTimeout = await connection.execute('PRAGMA busy_timeout');

    expect(Number(foreignKeys[0]?.foreign_keys)).toBe(1);

    expect(journalMode[0]?.journal_mode).toBe('wal');

    expect(Number(busyTimeout[0]?.timeout)).toBe(5000);
  });

  it('adds command revisions without changing existing command data', async () => {
    directory = await mkdtemp(join(tmpdir(), 'playlarr-database-'));
    orm = await MikroORM.init<SqliteDriver>(
      createDatabaseConfig(join(directory, 'playlarr.db')),
    );

    const migrator = orm.migrator;

    await migrator.up({ to: 'Migration20260908102644' });
    await orm.em.getConnection().execute(
      `insert into commands (id, type, payload_json, status, current, total, attempts, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'existing-command',
        'test.command',
        '{}',
        'running',
        1,
        2,
        1,
        '2026-10-02T10:00:00.000Z',
        '2026-10-02T10:00:00.000Z',
      ],
    );

    const lifecycle = new DatabaseLifecycle(orm);

    await lifecycle.onModuleInit();

    const commands = await orm.em
      .getConnection()
      .execute(
        'select id, status, current, revision from commands where id = ?',
        ['existing-command'],
      );

    expect(commands).toEqual([
      {
        id: 'existing-command',
        status: 'running',
        current: 1,
        revision: 0,
      },
    ]);
    await expect(migrator.getPending()).resolves.toEqual([]);
  });

  it('does not reapply completed migrations on an already-current database', async () => {
    const database = await createDatabase();
    const before = await database.orm.migrator.getExecuted();

    const lifecycle = new DatabaseLifecycle(database.orm);

    await expect(lifecycle.onModuleInit()).resolves.toBeUndefined();

    const after = await database.orm.migrator.getExecuted();

    expect(after).toEqual(before);
  });

  it('rejects startup and rolls back partial changes when a migration fails', async () => {
    directory = await mkdtemp(join(tmpdir(), 'playlarr-database-'));

    const config = createDatabaseConfig(join(directory, 'playlarr.db'));

    config.migrations = {
      ...config.migrations,
      migrationsList: [DeliberatelyFailingMigration],
    };

    orm = await MikroORM.init<SqliteDriver>(config);

    const lifecycle = new DatabaseLifecycle(orm);

    await expect(lifecycle.onModuleInit()).rejects.toThrow(
      /deliberately_missing_table/,
    );

    const partialTables = await orm.em
      .getConnection()
      .execute(
        "select name from sqlite_master where name = 'migration_partial_change'",
      );
    const executed = await orm.migrator.getExecuted();

    expect(partialTables).toEqual([]);
    expect(executed).toEqual([]);
  });
});
