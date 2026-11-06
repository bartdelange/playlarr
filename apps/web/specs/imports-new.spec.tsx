import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import NewImportPage from '../src/app/(app)/imports/new/page';

describe('new import source routing', () => {
  it.each([undefined, 'unknown'])(
    'shows source selection for %s',
    async (source) => {
      render(
        await NewImportPage({
          searchParams: Promise.resolve({ source }),
        }),
      );

      expect(screen.getByRole('heading', { name: 'New import' })).toBeTruthy();
    },
  );

  it('shows the TIDAL placeholder and authorization result explicitly', async () => {
    render(
      await NewImportPage({
        searchParams: Promise.resolve({
          source: 'tidal',
          tidal: 'error',
          tidal_error: 'missing_permissions',
        }),
      }),
    );

    expect(
      screen.getByRole('heading', { name: 'Import from TIDAL' }),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'TIDAL did not grant the required permissions.',
    );
  });
});
