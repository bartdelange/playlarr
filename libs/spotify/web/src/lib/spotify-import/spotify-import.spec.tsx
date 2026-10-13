import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SpotifyAuthorizationRequired,
  SpotifyPlaylistSelection,
} from './spotify-import';

const playlist = {
  id: 'playlist-one',
  name: 'Road trip',
  owner: { id: 'owner-one', displayName: 'Listener' },
  itemCount: 12,
  snapshotId: 'snapshot-one',
};

describe('Spotify import flow', () => {
  afterEach(() => vi.restoreAllMocks());

  it('guides a disconnected user through authorization and back to the flow', () => {
    render(<SpotifyAuthorizationRequired configured />);

    expect(
      screen
        .getByRole('link', { name: 'Authorize Spotify' })
        .getAttribute('href'),
    ).toBe(
      '/api/spotify/authorize?returnTo=%2Fimports%2Fnew%3Fsource%3Dspotify',
    );
  });

  it('shows an intentional empty state', () => {
    render(<SpotifyPlaylistSelection playlists={[]} />);

    expect(screen.getByText('No Spotify playlists were found.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Choose another source' }),
    ).toBeTruthy();
  });

  it('keeps the playlist selectable after a failed import so it can be retried', async () => {
    const user = userEvent.setup();
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 503 }));
    render(<SpotifyPlaylistSelection playlists={[playlist]} />);

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
    render(<SpotifyPlaylistSelection playlists={[playlist]} />);

    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(
      (
        await screen.findByRole('link', { name: 'Authorize Spotify' })
      ).getAttribute('href'),
    ).toBe(
      '/api/spotify/authorize?returnTo=%2Fimports%2Fnew%3Fsource%3Dspotify',
    );
  });
});
