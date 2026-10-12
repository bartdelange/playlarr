import React from 'react';
import { render, screen } from '@testing-library/react';

import HomePage from '../src/app/(app)/page';

describe('home page', () => {
  it('identifies the Playlarr workspace', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Playlarr' }),
    ).toBeTruthy();
  });
});
