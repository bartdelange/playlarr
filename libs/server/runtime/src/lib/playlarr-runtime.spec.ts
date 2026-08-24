import {
  createDatabase,
  migrateDatabase,
  type PlaylarrDatabase,
} from '@playlarr/server-persistence';
import { loadConfig } from '@playlarr/server-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaylarrRuntime } from './playlarr-runtime.js';

vi.mock('@playlarr/server-persistence', () => ({
  createDatabase: vi.fn(),
  migrateDatabase: vi.fn(),
}));

vi.mock('@playlarr/server-config', () => ({
  loadConfig: vi.fn(),
}));

const mockedCreateDatabase = vi.mocked(createDatabase);
const mockedMigrateDatabase = vi.mocked(migrateDatabase);
const mockedLoadConfig = vi.mocked(loadConfig);

describe('createPlaylarrRuntime', () => {
  const databaseConfig = {
    path: '/tmp/playlarr.db',
  };

  let close: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let database: PlaylarrDatabase;

  beforeEach(() => {
    vi.resetAllMocks();

    close = vi.fn().mockResolvedValue(undefined);

    database = {
      client: {} as PlaylarrDatabase['client'],
      close,
    };

    mockedLoadConfig.mockReturnValue({
      database: databaseConfig,
    });

    mockedMigrateDatabase.mockResolvedValue(undefined);
    mockedCreateDatabase.mockResolvedValue(database);
  });

  it('does not expose the database before startup', () => {
    const runtime = createPlaylarrRuntime();

    expect(() => runtime.database).toThrow(
      'Playlarr runtime has not been started',
    );
  });

  it('migrates and opens the database when started', async () => {
    const runtime = createPlaylarrRuntime();

    await runtime.start();

    expect(mockedMigrateDatabase).toHaveBeenCalledWith(databaseConfig);
    expect(mockedCreateDatabase).toHaveBeenCalledWith(databaseConfig);
    expect(runtime.database).toBe(database);
  });

  it('migrates before opening the database', async () => {
    const calls: string[] = [];

    mockedMigrateDatabase.mockImplementation(async () => {
      calls.push('migrate');
    });

    mockedCreateDatabase.mockImplementation(async () => {
      calls.push('create');
      return database;
    });

    const runtime = createPlaylarrRuntime();

    await runtime.start();

    expect(calls).toEqual(['migrate', 'create']);
  });

  it('rejects starting an already started runtime', async () => {
    const runtime = createPlaylarrRuntime();

    await runtime.start();

    await expect(runtime.start()).rejects.toThrow(
      'Playlarr runtime already started',
    );

    expect(mockedCreateDatabase).toHaveBeenCalledTimes(1);
  });

  it('closes the database when stopped', async () => {
    const runtime = createPlaylarrRuntime();

    await runtime.start();
    await runtime.stop();

    expect(close).toHaveBeenCalledOnce();

    expect(() => runtime.database).toThrow(
      'Playlarr runtime has not been started',
    );
  });

  it('allows stopping a runtime that was never started', async () => {
    const runtime = createPlaylarrRuntime();

    await expect(runtime.stop()).resolves.toBeUndefined();

    expect(close).not.toHaveBeenCalled();
  });

  it('can be started again after being stopped', async () => {
    const runtime = createPlaylarrRuntime();

    await runtime.start();
    await runtime.stop();
    await runtime.start();

    expect(mockedMigrateDatabase).toHaveBeenCalledTimes(2);
    expect(mockedCreateDatabase).toHaveBeenCalledTimes(2);
  });
});
