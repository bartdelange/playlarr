import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NewImport } from './new-import.js';

const spotifyServer = vi.hoisted(() => ({
  getSpotifyConfiguration: vi.fn(),
  getSpotifyPlaylists: vi.fn(),
}));
vi.mock('@playlarr/spotify-web/server', () => spotifyServer);
vi.mock('@playlarr/tidal-web/server', () => ({}));

describe('new import source routing', () => {
  it.each([undefined, 'unknown'])('shows source selection for %s', (source) => {
    render(<NewImport searchParams={{ source }} />);

    expect(screen.getByRole('heading', { name: 'New import' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Spotify/ }).getAttribute('href'),
    ).toBe('/imports/new?source=spotify');
    expect(
      screen.getByRole('link', { name: /TIDAL/ }).getAttribute('href'),
    ).toBe('/imports/new?source=tidal');
  });
});
