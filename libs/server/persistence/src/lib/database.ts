import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client.js';
import { spawn } from 'node:child_process';

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

export async function migrateDatabase({
  path,
}: DatabaseOptions): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'pnpm',
      [
        'exec',
        'prisma',
        'migrate',
        'deploy',
        '--config',
        'libs/server/persistence/prisma.config.ts',
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          DATABASE_URL: `file:${path}`,
        },
      },
    );

    child.once('error', reject);

    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Prisma migration failed with exit code ${code}`));
      }
    });
  });
}
