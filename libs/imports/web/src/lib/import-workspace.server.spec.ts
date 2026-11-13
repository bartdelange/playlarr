import { vi } from 'vitest';

import { getImportWorkspaceContext } from './import-workspace.server';

vi.mock('server-only', () => ({}));

const providerApis = vi.hoisted(() => ({
  getSpotifyImport: vi.fn(),
  getTidalImport: vi.fn(),
}));

vi.mock('@playlarr/spotify-web/server', () => ({
  getSpotifyImport: providerApis.getSpotifyImport,
}));
vi.mock('@playlarr/tidal-web/server', () => ({
  getTidalImport: providerApis.getTidalImport,
}));

describe('getImportWorkspaceContext', () => {
  it('resolves a provider import into shared workspace context', async () => {
    providerApis.getSpotifyImport.mockResolvedValue(null);
    providerApis.getTidalImport.mockResolvedValue({
      id: 'import-one',
      playlist: { name: 'Quiet evening' },
      tracks: [{ status: 'available' }, { status: 'unavailable' }],
    });

    await expect(getImportWorkspaceContext('import-one')).resolves.toEqual({
      id: 'import-one',
      name: 'Quiet evening',
      source: 'TIDAL',
      trackCount: 2,
      unavailableTrackCount: 1,
    });
  });

  it('returns null only when both providers confirm the import is missing', async () => {
    providerApis.getSpotifyImport.mockResolvedValue(null);
    providerApis.getTidalImport.mockResolvedValue(null);

    await expect(getImportWorkspaceContext('missing')).resolves.toBeNull();
  });

  it('does not misreport an unavailable provider as a missing import', async () => {
    providerApis.getSpotifyImport.mockRejectedValue(new Error('Unavailable'));
    providerApis.getTidalImport.mockResolvedValue(null);

    await expect(getImportWorkspaceContext('unknown')).rejects.toThrow(
      'Import workspace is unavailable',
    );
  });
});
