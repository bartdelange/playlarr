import { NotFoundException } from '@nestjs/common';
import type { CommandState } from '@playlarr/commands-domain';
import { CommandRepository } from '@playlarr/commands-persistence';
import { describe, expect, it, vi } from 'vitest';

import { CommandController } from './command.controller.js';

const state: CommandState = {
  id: 'command-1',
  type: 'test.command',
  status: 'running',
  current: 1,
  total: 2,
  attempts: 1,
  revision: 2,
  createdAt: '2026-10-02T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:01.000Z',
  startedAt: '2026-10-02T10:00:01.000Z',
};

describe('CommandController', () => {
  it('returns authoritative command state', async () => {
    const repository = Object.create(
      CommandRepository.prototype,
    ) as CommandRepository;
    vi.spyOn(repository, 'findStateById').mockResolvedValue(state);
    const controller = new CommandController(repository);

    await expect(controller.command('command-1')).resolves.toBe(state);
  });

  it('returns not found for an unknown command', async () => {
    const repository = Object.create(
      CommandRepository.prototype,
    ) as CommandRepository;
    vi.spyOn(repository, 'findStateById').mockResolvedValue(null);
    const controller = new CommandController(repository);

    await expect(controller.command('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
