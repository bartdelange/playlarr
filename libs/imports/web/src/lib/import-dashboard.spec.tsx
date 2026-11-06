import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { ImportDashboard, ImportDashboardSkeleton } from './import-dashboard';

const providerApis = vi.hoisted(() => ({
  getSpotifyImports: vi.fn(),
  getTidalImports: vi.fn(),
}));

vi.mock('@playlarr/spotify-web/server', () => ({
  getSpotifyImports: providerApis.getSpotifyImports,
}));
vi.mock('@playlarr/tidal-web/server', () => ({
  getTidalImports: providerApis.getTidalImports,
}));

describe('ImportDashboard', () => {
  it('shows persisted status and links each provider to its import workspace', async () => {
    providerApis.getSpotifyImports.mockResolvedValue([
      {
        id: '01d19f17-ff19-4e1f-b4c8-ec601f91b6f5',
        source: 'spotify',
        name: 'Road trip',
        trackCount: 42,
        unavailableTrackCount: 2,
        createdAt: '2026-11-05T10:00:00.000Z',
      },
    ]);
    providerApis.getTidalImports.mockResolvedValue([
      {
        id: '366ec008-0f13-40e9-a8e4-107ad87026fa',
        source: 'tidal',
        name: 'Quiet evening',
        trackCount: 18,
        unavailableTrackCount: 0,
        createdAt: '2026-11-06T10:00:00.000Z',
      },
    ]);

    render(await ImportDashboard());

    expect(screen.getAllByText('Matching required')).toHaveLength(2);
    expect(screen.getAllByText('Waiting for matching')).toHaveLength(2);
    expect(screen.getByText('2 tracks need review')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Road trip/ }).getAttribute('href'),
    ).toBe('/imports/01d19f17-ff19-4e1f-b4c8-ec601f91b6f5');
    expect(
      screen.getByRole('link', { name: /Quiet evening/ }).getAttribute('href'),
    ).toBe('/imports/366ec008-0f13-40e9-a8e4-107ad87026fa/tidal');
  });

  it('offers an import action when no local imports exist', async () => {
    providerApis.getSpotifyImports.mockResolvedValue([]);
    providerApis.getTidalImports.mockResolvedValue([]);

    render(await ImportDashboard());

    expect(screen.getByText('No imported playlists yet')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Import a playlist' })
        .getAttribute('href'),
    ).toBe('/imports/new');
  });

  it('announces loading while rendering the skeleton', () => {
    render(<ImportDashboardSkeleton />);

    expect(screen.getByRole('status').textContent).toBe(
      'Loading imported playlists…',
    );
  });
});
