import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const tidalServer = vi.hoisted(() => ({ getTidalImport: vi.fn() }));

vi.mock('@playlarr/tidal-web/server', () => tidalServer);
vi.mock('@playlarr/tidal-web', () => ({
  TidalImportWorkspace: ({ imported }: { imported: { id: string } }) => (
    <h1>TIDAL import {imported.id}</h1>
  ),
}));

import TidalImportWorkspacePage from '../src/app/(app)/imports/[importId]/tidal/page';

it('loads TIDAL imports from a provider-specific workspace route', async () => {
  tidalServer.getTidalImport.mockResolvedValue({ id: 'import-one' });

  render(
    await TidalImportWorkspacePage({
      params: Promise.resolve({ importId: 'import-one' }),
    }),
  );

  expect(tidalServer.getTidalImport).toHaveBeenCalledWith('import-one');
  expect(
    screen.getByRole('heading', { name: 'TIDAL import import-one' }),
  ).toBeTruthy();
});
