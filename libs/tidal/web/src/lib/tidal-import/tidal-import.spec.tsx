import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TidalImportUnavailable } from './tidal-import';

describe('TidalImportUnavailable', () => {
  it('shows the authorization result and a route back to source selection', () => {
    render(
      <TidalImportUnavailable
        authorizationResult={{
          status: 'error',
          error: 'authorization_expired',
        }}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'TIDAL authorization expired or was already used.',
    );
    expect(
      screen.getByText('TIDAL playlist importing is not available yet.'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Choose another source' })
        .getAttribute('href'),
    ).toBe('/imports/new');
  });
});
