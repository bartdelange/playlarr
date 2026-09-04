import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const e2eDatabasePath = join(tmpdir(), 'playlarr-e2e.sqlite');

export default async function globalSetup(): Promise<void> {
  await Promise.all([
    rm(e2eDatabasePath, { force: true }),
    rm(`${e2eDatabasePath}-wal`, { force: true }),
    rm(`${e2eDatabasePath}-shm`, { force: true }),
  ]);
}
