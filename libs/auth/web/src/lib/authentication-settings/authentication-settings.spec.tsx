import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationSettings } from './authentication-settings';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

describe('AuthenticationSettings', () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.restoreAllMocks();
  });

  it('separates pending edits from saved state and uses the server response', async () => {
    const user = userEvent.setup();
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ enabled: true, username: 'saved-operator' }),
      );

    render(
      <AuthenticationSettings
        initialConfiguration={{ enabled: false, username: '' }}
      />,
    );

    await user.click(
      screen.getByRole('checkbox', { name: 'Enable authentication' }),
    );

    expect(screen.getByText('Disabled')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Username'), 'operator');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(
      screen.getByRole('button', { name: 'Save authentication settings' }),
    );

    await screen.findByText('Authentication settings saved.');

    expect(request).toHaveBeenCalledWith('/api/auth/configuration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        username: 'operator',
        password: 'secret',
      }),
    });
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveValue('saved-operator');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('keeps saved state and clears the password when saving fails', async () => {
    const user = userEvent.setup();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ message: 'Settings were rejected' }, { status: 400 }),
    );

    render(
      <AuthenticationSettings
        initialConfiguration={{ enabled: true, username: 'operator' }}
      />,
    );

    await user.click(
      screen.getByRole('checkbox', { name: 'Enable authentication' }),
    );
    await user.type(screen.getByLabelText('New password'), 'secret');
    await user.click(
      screen.getByRole('button', { name: 'Save authentication settings' }),
    );

    await screen.findByText('Settings were rejected');

    expect(screen.getByText('Enabled')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('New password')).toHaveValue('');
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
