import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MikroORM } from '@mikro-orm/core';
import type { SqliteDriver } from '@mikro-orm/sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabaseConfig } from './database.config.js';
import { DatabaseLifecycle } from './database.lifecycle.js';

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

    await lifecycle.onApplicationBootstrap();

    return {
      path,
      orm,
    };
  }

  it('creates the SQLite database', async () => {
    const database = await createDatabase();

    await expect(access(database.path)).resolves.toBeUndefined();
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
});
