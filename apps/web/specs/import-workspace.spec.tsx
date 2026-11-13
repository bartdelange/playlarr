import { render, screen, within } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

const apis = vi.hoisted(() => ({
  getContext: vi.fn(),
  getSpotifyImport: vi.fn(),
  getTidalImport: vi.fn(),
}));

vi.mock('@playlarr/imports-web/server', () => ({
  getImportWorkspaceContext: apis.getContext,
}));
vi.mock('@playlarr/spotify-web/server', () => ({
  getSpotifyImport: apis.getSpotifyImport,
}));
vi.mock('@playlarr/tidal-web/server', () => ({
  getTidalImport: apis.getTidalImport,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
  usePathname: () => '/imports/import-one/matching',
}));

import ImportWorkspaceLayout from '../src/app/(app)/imports/[importId]/layout';
import MusicMatchingPage from '../src/app/(app)/imports/[importId]/matching/page';

const playlist = {
  id: 'playlist-one',
  name: 'Road trip',
  owner: { id: 'owner-one', displayName: 'Listener' },
  itemCount: 3,
  snapshotId: 'snapshot-one',
};

const repeatedTrack = (position: number) => ({
  position,
  status: 'available' as const,
  sourceId: 'track-one',
  name: 'Repeated song',
  artists: ['The Artist'],
  album: 'The Album',
  durationMs: 180_000,
  discNumber: 1,
  trackNumber: 1,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderWorkspace(source: 'Spotify' | 'TIDAL') {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response('null', {
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  const params = Promise.resolve({ importId: 'import-one' });
  apis.getContext.mockResolvedValue({
    id: 'import-one',
    name: playlist.name,
    source,
    trackCount: 3,
    unavailableTrackCount: 1,
  });
  const imported = {
    id: 'import-one',
    playlist,
    tracks: [
      repeatedTrack(0),
      repeatedTrack(1),
      { position: 2, status: 'unavailable' as const },
    ],
    createdAt: '2026-11-05T10:00:00.000Z',
  };

  if (source === 'Spotify') {
    apis.getSpotifyImport.mockResolvedValue(imported);
  } else {
    apis.getTidalImport.mockResolvedValue(imported);
  }

  const stage = await MusicMatchingPage({ params });
  render(await ImportWorkspaceLayout({ children: stage, params }));
  await screen.findByText('No command activity recorded for this import.');
}

describe('import workspace composition', () => {
  it.each(['Spotify', 'TIDAL'] as const)(
    'shows the %s snapshot in original order with duplicates and unavailable entries',
    async (source) => {
      await renderWorkspace(source);

      expect(screen.getByRole('heading', { name: 'Road trip' })).toBeTruthy();
      expect(
        screen
          .getByRole('link', { name: 'Music Matching' })
          .getAttribute('aria-current'),
      ).toBe('page');

      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(3);
      expect(within(items[0]).getByText('Repeated song')).toBeTruthy();
      expect(within(items[1]).getByText('Repeated song')).toBeTruthy();
      expect(
        within(items[2]).getByText('Unavailable source item'),
      ).toBeTruthy();

      if (source === 'Spotify') {
        expect(apis.getSpotifyImport).toHaveBeenCalledWith('import-one');
        expect(apis.getTidalImport).not.toHaveBeenCalled();
      } else {
        expect(apis.getTidalImport).toHaveBeenCalledWith('import-one');
        expect(apis.getSpotifyImport).not.toHaveBeenCalled();
      }
    },
  );
});
