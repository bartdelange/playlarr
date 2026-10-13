import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TidalSettings } from './tidal-settings';

describe('TidalSettings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('saves configuration and offers authorization', async () => {
    const user = userEvent.setup();
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        clientId: 'client-id',
        redirectUri: 'https://playlarr.example/api/tidal/callback',
        status: 'not_connected',
        account: null,
      }),
    );
    render(
      <TidalSettings
        initialConfiguration={{
          clientId: '',
          redirectUri: '',
          status: 'not_configured',
          account: null,
        }}
      />,
    );

    await user.type(screen.getByLabelText('Client ID'), 'client-id');
    await user.type(
      screen.getByLabelText('Redirect URI'),
      'https://playlarr.example/api/tidal/callback',
    );
    await user.click(
      screen.getByRole('button', { name: 'Save TIDAL settings' }),
    );

    await screen.findByText(
      'TIDAL settings saved. Authorize the app to connect.',
    );
    expect(request).toHaveBeenCalledWith('/api/tidal/configuration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-id',
        redirectUri: 'https://playlarr.example/api/tidal/callback',
      }),
    });
    expect(
      screen
        .getByRole('link', { name: 'Authorize TIDAL' })
        .getAttribute('href'),
    ).toBe('/api/tidal/authorize?returnTo=%2Fsettings');
  });

  it('shows an actionable reconnect state', () => {
    render(
      <TidalSettings
        initialConfiguration={{
          clientId: 'client-id',
          redirectUri: 'https://playlarr.example/api/tidal/callback',
          status: 'reconnect_required',
          account: { id: 'account-1' },
        }}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Reconnect');
    expect(screen.getByText('Previously connected as account-1.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Authorize TIDAL' })).toBeTruthy();
  });

  it('does not display arbitrary provider error values', () => {
    render(
      <TidalSettings
        authorizationResult={{ status: 'error', error: 'private_detail' }}
        initialConfiguration={{
          clientId: 'client-id',
          redirectUri: 'https://playlarr.example/api/tidal/callback',
          status: 'not_connected',
          account: null,
        }}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'TIDAL could not complete authorization.',
    );
    expect(screen.queryByText(/private_detail/)).toBeNull();
  });
});
