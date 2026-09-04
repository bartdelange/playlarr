import { MikroORM } from '@mikro-orm/core';

export async function configureSqlite(orm: MikroORM): Promise<void> {
  const connection = orm.em.getConnection();

  await connection.execute('PRAGMA foreign_keys = ON');
  await connection.execute('PRAGMA journal_mode = WAL');
  await connection.execute('PRAGMA busy_timeout = 5000');
}
