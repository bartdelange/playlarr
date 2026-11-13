import { render, screen } from '@testing-library/react';
import { ImportWorkspace, ImportWorkspaceSkeleton } from './import-workspace';

const stageNavigation = <nav aria-label="Import stages">Stages</nav>;

const imported = {
  id: 'import-one',
  name: 'Road trip',
  source: 'Spotify' as const,
  trackCount: 42,
  unavailableTrackCount: 2,
};

describe('ImportWorkspace', () => {
  it('keeps import context and activity around stage content', () => {
    const { rerender } = render(
      <ImportWorkspace imported={imported} navigation={stageNavigation}>
        <h2>Music Matching content</h2>
      </ImportWorkspace>,
    );

    expect(screen.getByRole('heading', { name: 'Road trip' })).toBeTruthy();
    expect(screen.getByText('Spotify import')).toBeTruthy();
    expect(screen.getByText('42 tracks · 2 items need review')).toBeTruthy();
    expect(
      screen.getByText('Import activity will appear here when available.'),
    ).toBeTruthy();

    rerender(
      <ImportWorkspace imported={imported} navigation={stageNavigation}>
        <h2>Lidarr content</h2>
      </ImportWorkspace>,
    );

    expect(
      screen.getByRole('heading', { name: 'Lidarr content' }),
    ).toBeTruthy();
    expect(
      screen.getByText('Import activity will appear here when available.'),
    ).toBeTruthy();
  });

  it('announces workspace loading', () => {
    render(<ImportWorkspaceSkeleton />);

    expect(screen.getByRole('status').textContent).toBe(
      'Loading import workspace…',
    );
  });
});
