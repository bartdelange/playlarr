import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpotifyImportEntity } from './spotify-import.entity.js';
import { SpotifyRepository } from './spotify.repository.js';

describe('SpotifyRepository import summaries', () => {
  let directory: string;
  let orm: MikroORM;
  let repository: SpotifyRepository;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'playlarr-spotify-'));
    orm = await MikroORM.init({
      dbName: join(directory, 'spotify.sqlite'),
      entities: [SpotifyImportEntity],
      metadataProvider: ReflectMetadataProvider,
    });
    await orm.schema.create();
    repository = new SpotifyRepository(orm);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await orm.close(true);
    await rm(directory, { recursive: true, force: true });
  });

  it('projects ordered counts from persisted JSON without losing duplicates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T10:00:00.000Z'));
    const first = await repository.createImport(
      {
        id: 'playlist-one',
        name: 'Road trip',
        owner: { id: 'owner', displayName: 'Owner' },
        itemCount: 3,
        snapshotId: 'snapshot-one',
      },
      [
        {
          position: 0,
          status: 'available',
          sourceId: 'duplicate',
          name: 'Song',
          artists: ['Artist'],
          album: 'Album',
          durationMs: 1000,
          discNumber: 1,
          trackNumber: 1,
        },
        {
          position: 1,
          status: 'available',
          sourceId: 'duplicate',
          name: 'Song',
          artists: ['Artist'],
          album: 'Album',
          durationMs: 1000,
          discNumber: 1,
          trackNumber: 1,
        },
        { position: 2, status: 'unavailable' },
      ],
    );

    vi.setSystemTime(new Date('2026-11-06T10:00:00.000Z'));
    const second = await repository.createImport(
      {
        id: 'playlist-two',
        name: 'Quiet evening',
        owner: { id: 'owner', displayName: 'Owner' },
        itemCount: 0,
        snapshotId: 'snapshot-two',
      },
      [],
    );

    await expect(repository.listImports()).resolves.toEqual([
      {
        id: second.id,
        name: 'Quiet evening',
        trackCount: 0,
        unavailableTrackCount: 0,
        createdAt: '2026-11-06T10:00:00.000Z',
      },
      {
        id: first.id,
        name: 'Road trip',
        trackCount: 3,
        unavailableTrackCount: 1,
        createdAt: '2026-11-05T10:00:00.000Z',
      },
    ]);
  });
});
