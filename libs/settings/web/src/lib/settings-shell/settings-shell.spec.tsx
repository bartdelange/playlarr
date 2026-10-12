import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SettingsShell } from './settings-shell';

describe('SettingsShell', () => {
  it('shows only the implemented authentication destination', () => {
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
      screen.getByRole('link', { name: 'Authentication' }).getAttribute('href'),
    ).toBe('/settings');
    expect(screen.getByText('Capability settings')).toBeTruthy();
  });
});
