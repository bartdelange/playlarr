import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createDatabase } from './database.js';

const execFileAsync = promisify(execFile);

interface TestDatabase {
  directory: string;
  path: string;
  url: string;
  migrate(): Promise<void>;
  cleanup(): Promise<void>;
}

async function createTestDatabase(): Promise<TestDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'playlarr-'));
  const path = join(directory, 'playlarr.db');
  const url = `file:${path}`;

  return {
    directory,
    path,
    url,

    async migrate() {
      await execFileAsync(
        'pnpm',
        [
          'prisma',
          'migrate',
          'deploy',
          '--config',
          resolve(process.cwd(), 'prisma.config.ts'),
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATABASE_URL: url,
          },
        },
      );
    },

    async cleanup() {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    },
  };
}

export async function createMigratedTestDatabase() {
  const database = await createTestDatabase();
  await database.migrate();
  return database;
}

describe('database integration', () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it('creates and migrates a fresh database', async () => {
    testDatabase = await createMigratedTestDatabase();

    const database = await createDatabase({
      path: testDatabase.path,
    });

    await expect(database.client.runtimeMetadata.findMany()).resolves.toEqual(
      [],
    );

    await database.close();
  });

  it('configures the required SQLite pragmas', async () => {
    testDatabase = await createMigratedTestDatabase();

    const database = await createDatabase({
      path: testDatabase.path,
    });

    const foreignKeys = await database.client.$queryRawUnsafe<
      Array<{ foreign_keys: number }>
    >('PRAGMA foreign_keys');

    const journalMode = await database.client.$queryRawUnsafe<
      Array<{ journal_mode: string }>
    >('PRAGMA journal_mode');

    const busyTimeout = await database.client.$queryRawUnsafe<
      Array<{ timeout: number }>
    >('PRAGMA busy_timeout');

    expect(foreignKeys[0]?.foreign_keys).toBe(1n);
    expect(journalMode[0]?.journal_mode).toBe('wal');
    expect(busyTimeout[0]?.timeout).toBe(5000n);

    await database.close();
  });

  it('preserves state after closing and reopening', async () => {
    testDatabase = await createMigratedTestDatabase();

    const first = await createDatabase({
      path: testDatabase.path,
    });

    await first.client.runtimeMetadata.create({
      data: {
        key: 'restart-test',
        value: 'survives',
      },
    });

    await first.close();

    const second = await createDatabase({
      path: testDatabase.path,
    });

    const metadata = await second.client.runtimeMetadata.findUnique({
      where: {
        key: 'restart-test',
      },
    });

    expect(metadata?.value).toBe('survives');

    await second.close();
  });

  it('fails initialization when the database cannot be opened', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'playlarr-invalid-'));

    try {
      await expect(
        createDatabase({
          path: directory,
        }),
      ).rejects.toThrow();
    } finally {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }
  });
});
