import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NewImport } from './new-import.js';

const spotifyServer = vi.hoisted(() => ({
  getSpotifyConfiguration: vi.fn(),
  getSpotifyPlaylists: vi.fn(),
}));

vi.mock('@playlarr/spotify-web/server', () => spotifyServer);

describe('new import source routing', () => {
  it.each([undefined, 'unknown'])('shows source selection for %s', (source) => {
    render(<NewImport searchParams={{ source }} />);

    expect(screen.getByRole('heading', { name: 'New import' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Spotify/ }).getAttribute('href'),
    ).toBe('/imports/new?source=spotify');
  });

  it('shows the TIDAL placeholder and authorization result explicitly', () => {
    render(
      <NewImport
        searchParams={{
          source: 'tidal',
          tidal: 'error',
          tidal_error: 'missing_permissions',
        }}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Import from TIDAL' }),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'TIDAL did not grant the required permissions.',
    );
  });
});
