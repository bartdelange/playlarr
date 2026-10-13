import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpotifySettings } from './spotify-settings';

describe('SpotifySettings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps an existing server-side secret when saving other settings', async () => {
    const user = userEvent.setup();
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        clientId: 'changed-client',
        redirectUri: 'https://new.example/api/spotify/callback',
        clientSecretConfigured: true,
        status: 'not_connected',
        account: null,
      }),
    );
    render(
      <SpotifySettings
        initialConfiguration={{
          clientId: 'client-id',
          redirectUri: 'https://old.example/api/spotify/callback',
          clientSecretConfigured: true,
          status: 'connected',
          account: { id: 'account-1', displayName: 'Listener' },
        }}
      />,
    );

    const clientId = screen.getByLabelText('Client ID');
    const redirectUri = screen.getByLabelText('Redirect URI');
    await user.clear(clientId);
    await user.type(clientId, 'changed-client');
    await user.clear(redirectUri);
    await user.type(redirectUri, 'https://new.example/api/spotify/callback');
    await user.click(
      screen.getByRole('button', { name: 'Save Spotify settings' }),
    );

    await screen.findByText(
      'Spotify settings saved. Authorize the app to connect.',
    );
    expect(request).toHaveBeenCalledWith('/api/spotify/configuration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'changed-client',
        redirectUri: 'https://new.example/api/spotify/callback',
        clientSecret: undefined,
      }),
    });
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(
      (screen.getByLabelText('New client secret') as HTMLInputElement).value,
    ).toBe('');
  });

  it('shows a reconnect action when authorization has been revoked', () => {
    render(
      <SpotifySettings
        initialConfiguration={{
          clientId: 'client-id',
          redirectUri: 'https://playlarr.example/api/spotify/callback',
          clientSecretConfigured: true,
          status: 'reconnect_required',
          account: { id: 'account-1', displayName: null },
        }}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Reconnect');
    expect(
      screen
        .getByRole('link', { name: 'Authorize Spotify' })
        .getAttribute('href'),
    ).toBe('/api/spotify/authorize?returnTo=%2Fsettings');
  });
});
