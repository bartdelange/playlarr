import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const navigation = vi.hoisted(() => ({
  pathname: '/imports/import-one/matching',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

import { ImportWorkspaceNavigation } from '../src/app/(app)/imports/[importId]/navigation';

it('links every stage to the same import and marks the current stage', () => {
  render(<ImportWorkspaceNavigation importId="import-one" />);

  const matching = screen.getByRole('link', { name: 'Music Matching' });
  const lidarr = screen.getByRole('link', { name: 'Lidarr' });
  const library = screen.getByRole('link', { name: 'Library' });

  expect(matching.getAttribute('href')).toBe('/imports/import-one/matching');
  expect(matching.getAttribute('aria-current')).toBe('page');
  expect(lidarr.getAttribute('href')).toBe('/imports/import-one/lidarr');
  expect(library.getAttribute('href')).toBe('/imports/import-one/library');
});
