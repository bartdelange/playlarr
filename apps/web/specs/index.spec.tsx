import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('@playlarr/imports-web/server', () => ({
  ImportDashboard: () => <h1>Imported playlists</h1>,
  ImportDashboardSkeleton: () => <p>Loading imports</p>,
}));

import HomePage from '../src/app/(app)/(dashboard)/page';

describe('home page', () => {
  it('composes the import dashboard', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Imported playlists' }),
    ).toBeTruthy();
  });
});
