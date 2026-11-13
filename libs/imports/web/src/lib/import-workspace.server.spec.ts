import { vi } from 'vitest';

import { getImportWorkspaceContext } from './import-workspace.server';

vi.mock('server-only', () => ({}));

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

describe('getImportWorkspaceContext', () => {
  it('resolves a provider import into shared workspace context', async () => {
    providerApis.getSpotifyImports.mockResolvedValue([]);
    providerApis.getTidalImports.mockResolvedValue([
      {
        id: 'import-one',
        source: 'tidal',
        name: 'Quiet evening',
        trackCount: 2,
        unavailableTrackCount: 1,
        createdAt: '2026-11-05T10:00:00.000Z',
      },
    ]);

    await expect(getImportWorkspaceContext('import-one')).resolves.toEqual({
      id: 'import-one',
      name: 'Quiet evening',
      source: 'TIDAL',
      trackCount: 2,
      unavailableTrackCount: 1,
    });
  });

  it('returns null only when both providers confirm the import is missing', async () => {
    providerApis.getSpotifyImports.mockResolvedValue([]);
    providerApis.getTidalImports.mockResolvedValue([]);

    await expect(getImportWorkspaceContext('missing')).resolves.toBeNull();
  });

  it('does not misreport an unavailable provider as a missing import', async () => {
    providerApis.getSpotifyImports.mockRejectedValue(new Error('Unavailable'));
    providerApis.getTidalImports.mockResolvedValue([]);

    await expect(getImportWorkspaceContext('unknown')).rejects.toThrow(
      'Import workspace is unavailable',
    );
  });
});
