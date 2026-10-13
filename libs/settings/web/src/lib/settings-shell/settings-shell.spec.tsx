import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SettingsShell } from './settings-shell';

describe('SettingsShell', () => {
  it('shows the general settings destination', () => {
    render(
      <SettingsShell>
        <p>Capability settings</p>
      </SettingsShell>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Settings' }),
    ).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'General' }).getAttribute('href'),
    ).toBe('/settings');
    expect(screen.getByText('Capability settings')).toBeTruthy();
  });
});
