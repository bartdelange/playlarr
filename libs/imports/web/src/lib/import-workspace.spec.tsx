import { act, render, screen, waitFor } from '@testing-library/react';
import type { CommandState } from '@playlarr/commands-contracts';
import { afterEach, vi } from 'vitest';
import { ImportWorkspace, ImportWorkspaceSkeleton } from './import-workspace';
import { ImportActivity } from './import-activity';

const stageNavigation = <nav aria-label="Import stages">Stages</nav>;

const imported = {
  id: 'import-one',
  name: 'Road trip',
  source: 'Spotify' as const,
  trackCount: 42,
  unavailableTrackCount: 2,
};

const command = (overrides: Partial<CommandState> = {}): CommandState => ({
  id: 'command-one',
  type: 'sample.delay',
  status: 'running',
  current: 1,
  total: 3,
  currentItem: 'Waiting 1 of 3',
  attempts: 1,
  revision: 2,
  association: { scope: 'imports', entityId: 'import-one' },
  createdAt: '2026-11-13T10:00:00.000Z',
  updatedAt: '2026-11-13T10:00:01.000Z',
  startedAt: '2026-11-13T10:00:01.000Z',
  ...overrides,
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, EventListener[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, value?: unknown): void {
    const event =
      value === undefined
        ? new Event(type)
        : new MessageEvent(type, { data: JSON.stringify(value) });

    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const response = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });

const activity = <ImportActivity importId={imported.id} />;

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.instances = [];
});

describe('ImportWorkspace', () => {
  it('keeps active progress visible while stage content changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([command()])));
    vi.stubGlobal('EventSource', FakeEventSource);

    const { rerender } = render(
      <ImportWorkspace
        activity={activity}
        imported={imported}
        navigation={stageNavigation}
      >
        <h2>Music Matching content</h2>
      </ImportWorkspace>,
    );

    expect(screen.getByRole('heading', { name: 'Road trip' })).toBeTruthy();
    expect(screen.getByText('Spotify import')).toBeTruthy();
    expect(screen.getByText('42 tracks · 2 items need review')).toBeTruthy();
    expect(await screen.findByText('Waiting 1 of 3 (1/3)')).toBeTruthy();
    expect(FakeEventSource.instances[0]?.url).toBe(
      '/api/events?scope=imports&entityId=import-one',
    );

    rerender(
      <ImportWorkspace
        activity={activity}
        imported={imported}
        navigation={stageNavigation}
      >
        <h2>Lidarr content</h2>
      </ImportWorkspace>,
    );

    expect(
      screen.getByRole('heading', { name: 'Lidarr content' }),
    ).toBeTruthy();
    expect(screen.getByText('Waiting 1 of 3 (1/3)')).toBeTruthy();
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => {
      FakeEventSource.instances[0]?.emit('command.progress', {
        type: 'command.progress',
        occurredAt: '2026-11-13T10:00:02.000Z',
        command: command({
          current: 2,
          currentItem: 'Waiting 2 of 3',
          revision: 3,
        }),
      });
    });

    expect(screen.getByText('Waiting 2 of 3 (2/3)')).toBeTruthy();
  });

  it('shows terminal command states received over the shared stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([command()])));
    vi.stubGlobal('EventSource', FakeEventSource);
    render(
      <ImportWorkspace
        activity={activity}
        imported={imported}
        navigation={stageNavigation}
      >
        <h2>Music Matching content</h2>
      </ImportWorkspace>,
    );

    await screen.findByText('Waiting 1 of 3 (1/3)');

    act(() => {
      FakeEventSource.instances[0]?.emit('command.completed', {
        type: 'command.completed',
        occurredAt: '2026-11-13T10:00:03.000Z',
        command: command({ status: 'completed', revision: 4 }),
      });
    });

    expect(screen.getByText('Background work completed.')).toBeTruthy();
  });

  it('reconciles persisted progress when the event stream reconnects', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response([command()]))
      .mockResolvedValueOnce(
        response([
          command({
            current: 3,
            currentItem: 'Waiting 3 of 3',
            status: 'completed',
            revision: 4,
          }),
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', FakeEventSource);
    render(
      <ImportWorkspace
        activity={activity}
        imported={imported}
        navigation={stageNavigation}
      >
        <h2>Music Matching content</h2>
      </ImportWorkspace>,
    );

    await screen.findByText('Waiting 1 of 3 (1/3)');

    act(() => {
      FakeEventSource.instances[0]?.emit('error');
    });

    expect(await screen.findByText('Background work completed.')).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/commands?scope=imports&entityId=import-one',
        { cache: 'no-store' },
      );
    });
    expect(FakeEventSource.instances[0]?.closed).toBe(false);

    act(() => {
      FakeEventSource.instances[0]?.emit('command.snapshot', {
        type: 'command.snapshot',
        occurredAt: '2026-11-13T10:00:04.000Z',
        command: command({ current: 2, revision: 3 }),
      });
    });

    expect(screen.getByText('Background work completed.')).toBeTruthy();
  });

  it('observes a command that starts after the workspace is open', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    vi.stubGlobal('EventSource', FakeEventSource);
    render(
      <ImportWorkspace
        activity={activity}
        imported={imported}
        navigation={stageNavigation}
      >
        <h2>Music Matching content</h2>
      </ImportWorkspace>,
    );

    await screen.findByText('No command activity recorded for this import.');

    act(() => {
      FakeEventSource.instances[0]?.emit('command.started', {
        type: 'command.started',
        occurredAt: '2026-11-13T10:00:02.000Z',
        command: command(),
      });
    });

    expect(screen.getByText('Waiting 1 of 3 (1/3)')).toBeTruthy();
  });

  it('shows every active command associated with the import', async () => {
    const second = command({
      id: 'command-two',
      current: 0,
      currentItem: 'Preparing another job',
      revision: 1,
      createdAt: '2026-11-13T10:00:02.000Z',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response([command(), second])),
    );
    vi.stubGlobal('EventSource', FakeEventSource);
    render(
      <ImportWorkspace
        activity={activity}
        imported={imported}
        navigation={stageNavigation}
      >
        <h2>Music Matching content</h2>
      </ImportWorkspace>,
    );

    expect(await screen.findByText('Waiting 1 of 3 (1/3)')).toBeTruthy();
    expect(screen.getByText('Preparing another job (0/3)')).toBeTruthy();
  });

  it('uses persisted insertion order for the latest terminal command', async () => {
    const createdAt = '2026-11-13T10:00:00.000Z';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response([
          command({
            id: 'z-older',
            status: 'failed',
            revision: 4,
            createdAt,
          }),
          command({
            id: 'a-newer',
            status: 'completed',
            revision: 4,
            createdAt,
          }),
        ]),
      ),
    );
    vi.stubGlobal('EventSource', FakeEventSource);

    render(<ImportActivity importId={imported.id} />);

    expect(await screen.findByText('Background work completed.')).toBeTruthy();
    expect(screen.queryByText('Background work failed.')).toBeNull();
  });

  it('announces workspace loading', () => {
    render(<ImportWorkspaceSkeleton />);

    expect(screen.getByRole('status').textContent).toBe(
      'Loading import workspace…',
    );
  });
});
