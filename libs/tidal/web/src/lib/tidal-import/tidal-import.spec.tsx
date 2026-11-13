import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TidalAuthorizationRequired,
  TidalPlaylistSelection,
  tidalImportWorkspacePath,
} from './tidal-import';

const playlist = {
  id: 'playlist-one',
  name: 'Evening mix',
  owner: { id: 'owner-one', displayName: 'Listener' },
  itemCount: 7,
  snapshotId: 'snapshot-one',
};

describe('TIDAL import flow', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the canonical import workspace path', () => {
    expect(tidalImportWorkspacePath('import/one')).toBe(
      '/imports/import%2Fone',
    );
  });

  it('guides a disconnected user through authorization and back to the flow', () => {
    render(
      <TidalAuthorizationRequired
        authorizationResult={{
          status: 'error',
          error: 'authorization_expired',
        }}
        configured
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'TIDAL authorization expired or was already used.',
    );
    expect(
      screen
        .getByRole('link', { name: 'Authorize TIDAL' })
        .getAttribute('href'),
    ).toBe('/api/tidal/authorize?returnTo=%2Fimports%2Fnew%3Fsource%3Dtidal');
  });

  it('shows useful playlist metadata and an intentional empty state', () => {
    const { rerender } = render(
      <TidalPlaylistSelection playlists={[playlist]} />,
    );
    expect(screen.getByText('Listener · 7 items')).toBeTruthy();

    rerender(<TidalPlaylistSelection playlists={[]} />);
    expect(screen.getByText('No TIDAL playlists were found.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Choose another source' }),
    ).toBeTruthy();
  });

  it('keeps the playlist selectable after a failed import so it can be retried', async () => {
    const user = userEvent.setup();
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 503 }));
    render(<TidalPlaylistSelection playlists={[playlist]} />);

    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Unable to import this playlist. Please try again.',
    );
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('guides the user back through authorization when import access expires', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    render(<TidalPlaylistSelection playlists={[playlist]} />);

    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(
      (
        await screen.findByRole('link', { name: 'Authorize TIDAL' })
      ).getAttribute('href'),
    ).toBe('/api/tidal/authorize?returnTo=%2Fimports%2Fnew%3Fsource%3Dtidal');
  });
});
