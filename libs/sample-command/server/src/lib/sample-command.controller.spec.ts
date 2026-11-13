import { BadRequestException } from '@nestjs/common';
import { CommandService } from '@playlarr/commands-server';
import { describe, expect, it, vi } from 'vitest';

import { SampleCommandController } from './sample-command.controller.js';

describe('SampleCommandController', () => {
  it('associates demo work with an import when requested', async () => {
    const commands = Object.create(CommandService.prototype) as CommandService;
    vi.spyOn(commands, 'enqueue').mockResolvedValue('command-one');
    const controller = new SampleCommandController(commands);

    await expect(
      controller.execute({ steps: 3, importId: ' import-one ' }),
    ).resolves.toEqual({ commandId: 'command-one' });
    expect(commands.enqueue).toHaveBeenCalledWith(
      'sample.delay',
      { steps: 3 },
      { scope: 'imports', entityId: 'import-one' },
    );
  });

  it('rejects an empty import association', async () => {
    const commands = Object.create(CommandService.prototype) as CommandService;
    const controller = new SampleCommandController(commands);

    await expect(
      controller.execute({ steps: 3, importId: ' ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
