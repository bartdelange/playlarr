import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CommandEntity } from './command.entity.js';
import { CommandRepository } from './command.repository.js';

describe('CommandRepository', () => {
  let directory: string;
  let databasePath: string;
  let orm: MikroORM;
  let repository: CommandRepository;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'playlarr-commands-'));

    databasePath = join(directory, 'commands.sqlite');

    orm = await MikroORM.init({
      dbName: databasePath,
      entities: [CommandEntity],
      metadataProvider: ReflectMetadataProvider,
    });

    await orm.schema.create();

    repository = new CommandRepository(orm);
  });

  afterEach(async () => {
    await orm.close(true);

    await rm(directory, {
      recursive: true,
      force: true,
    });
  });

  it('persists a queued command', async () => {
    const created = await repository.create('test.command', {
      hello: 'world',
    });

    const found = await repository.findById(created.id);

    expect(found).toMatchObject({
      id: created.id,
      type: 'test.command',
      status: 'queued',
      attempts: 0,
      current: 0,
      total: 0,
    });

    expect(found?.payloadJson).toEqual({
      hello: 'world',
    });
  });

  it('persists command progress', async () => {
    const command = await repository.create('test.command', {});

    const claimed = await repository.claimNext();

    expect(claimed?.id).toBe(command.id);

    await repository.updateProgress(command.id, 2, 5, 'Doing thing 2');

    const found = await repository.findById(command.id);

    expect(found).toMatchObject({
      status: 'running',
      current: 2,
      total: 5,
      currentItem: 'Doing thing 2',
    });
  });

  it('completes a running command', async () => {
    const command = await repository.create('test.command', {});

    await repository.claimNext();

    await repository.complete(command.id);

    const found = await repository.findById(command.id);

    expect(found?.status).toBe('completed');
    expect(found?.completedAt).toBeInstanceOf(Date);
  });

  it('persists command failures', async () => {
    const command = await repository.create('test.command', {});

    await repository.claimNext();

    await repository.fail(command.id, 'kaboom');

    const found = await repository.findById(command.id);

    expect(found).toMatchObject({
      status: 'failed',
      error: 'kaboom',
    });

    expect(found?.completedAt).toBeInstanceOf(Date);
  });

  it('claims the oldest queued command first', async () => {
    const first = await repository.create('first.command', {});

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await repository.create('second.command', {});

    const claimed = await repository.claimNext();

    expect(claimed?.id).toBe(first.id);
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempts).toBe(1);

    const secondPersisted = await repository.findById(second.id);

    expect(secondPersisted?.status).toBe('queued');
  });

  it('does not allow the same command to be claimed twice', async () => {
    const command = await repository.create('test.command', {});

    const [first, second] = await Promise.all([
      repository.claimNext(),
      repository.claimNext(),
    ]);

    const claimedIds = [first?.id, second?.id].filter(
      (id): id is string => id !== undefined && id !== null,
    );

    expect(claimedIds).toEqual([command.id]);

    const found = await repository.findById(command.id);

    expect(found?.status).toBe('running');
    expect(found?.attempts).toBe(1);
  });

  it('persists queued commands across database close and reopen', async () => {
    const command = await repository.create('test.persisted', {
      hello: 'world',
    });

    await orm.close(true);

    orm = await MikroORM.init({
      dbName: databasePath,
      entities: [CommandEntity],
      metadataProvider: ReflectMetadataProvider,
    });

    repository = new CommandRepository(orm);

    const found = await repository.findById(command.id);

    expect(found).toMatchObject({
      id: command.id,
      type: 'test.persisted',
      status: 'queued',
      attempts: 0,
    });

    expect(found?.payloadJson).toEqual({
      hello: 'world',
    });
  });

  it('requeues an interrupted running command', async () => {
    const command = await repository.create('test.command', {});

    await repository.claimNext();

    await repository.requeue(command.id);

    const found = await repository.findById(command.id);

    expect(found).toMatchObject({
      status: 'queued',
      attempts: 1,
    });

    expect(found?.startedAt).toBeNull();
  });

  it('finds running commands', async () => {
    const running = await repository.create('running.command', {});

    await repository.create('queued.command', {});

    await repository.claimNext();

    const commands = await repository.findRunning();

    expect(commands).toHaveLength(1);
    expect(commands[0]?.id).toBe(running.id);
  });
});
