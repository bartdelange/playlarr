import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export default async function globalSetup(): Promise<void> {
  const databasePath = resolve('apps/web-e2e/test-output/e2e.sqlite');

  await mkdir(dirname(databasePath), { recursive: true });

  await Promise.all([
    rm(databasePath, {
      force: true,
    }),
    rm(`${databasePath}-wal`, {
      force: true,
    }),
    rm(`${databasePath}-shm`, {
      force: true,
    }),
  ]);
}
