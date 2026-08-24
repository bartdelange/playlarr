import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client.js';

export interface DatabaseOptions {
  path: string;
}

export interface PlaylarrDatabase {
  readonly client: PrismaClient;
  close(): Promise<void>;
}

export async function createDatabase({
  path,
}: DatabaseOptions): Promise<PlaylarrDatabase> {
  const adapter = new PrismaBetterSqlite3({
    url: `file:${path}`,
  });

  const client = new PrismaClient({ adapter });

  await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await client.$executeRawUnsafe('PRAGMA journal_mode = WAL');
  await client.$executeRawUnsafe('PRAGMA busy_timeout = 5000');

  return {
    client,

    async close() {
      await client.$disconnect();
    },
  };
}
