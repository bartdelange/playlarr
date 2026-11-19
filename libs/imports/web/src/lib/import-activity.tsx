'use client';

import {
  commandEventSchema,
  commandStatesSchema,
  type CommandState,
} from '@playlarr/commands-contracts';
import { useEffect, useState } from 'react';

const active = (command: CommandState): boolean =>
  command.status === 'queued' || command.status === 'running';

const mergeCommands = (
  current: readonly CommandState[] | undefined,
  incoming: readonly CommandState[],
): CommandState[] => {
  const commands = new Map(current?.map((command) => [command.id, command]));

  for (const candidate of incoming) {
    const existing = commands.get(candidate.id);

    if (existing === undefined || candidate.revision >= existing.revision) {
      commands.set(candidate.id, candidate);
    }
  }

  return [...commands.values()];
};

async function fetchCommands(url: string): Promise<CommandState[]> {
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Command status request failed with ${response.status}`);
  }

  return commandStatesSchema.parse(await response.json());
}

const commandStatus = (command: CommandState): string => {
  if (command.status === 'queued') {
    return 'Background work is waiting to start.';
  }

  if (command.status === 'completed') {
    return 'Background work completed.';
  }

  if (command.status === 'failed') {
    return 'Background work failed.';
  }

  const progress =
    command.total > 0 ? ` (${command.current}/${command.total})` : '';

  return `${command.currentItem ?? 'Background work in progress'}${progress}`;
};

export function ImportActivity({ importId }: { importId: string }) {
  const [commands, setCommands] = useState<CommandState[]>();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({
      scope: 'imports',
      entityId: importId,
    });
    const statusUrl = `/api/commands?${query.toString()}`;
    const events = new EventSource(`/api/events?${query.toString()}`);

    const apply = (incoming: readonly CommandState[]) => {
      if (!cancelled) {
        setCommands((current) => mergeCommands(current, incoming));
        setUnavailable(false);
      }
    };

    const reconcile = async () => {
      try {
        apply(await fetchCommands(statusUrl));
      } catch {
        if (!cancelled) {
          setUnavailable(true);
        }
      }
    };

    const receive = (event: MessageEvent<string>) => {
      try {
        const parsed = commandEventSchema.parse(JSON.parse(event.data));
        apply([parsed.command]);
      } catch {
        // Ignore malformed external data and retain the last valid state.
      }
    };

    for (const type of [
      'command.snapshot',
      'command.started',
      'command.progress',
      'command.completed',
      'command.failed',
    ]) {
      events.addEventListener(type, receive as EventListener);
    }

    events.addEventListener('error', () => {
      void reconcile();
    });

    void reconcile();

    return () => {
      cancelled = true;
      events.close();
    };
  }, [importId]);

  if (unavailable && commands === undefined) {
    return <p role="status">Activity status is temporarily unavailable.</p>;
  }

  if (commands === undefined) {
    return <p role="status">Checking import activity…</p>;
  }

  if (commands.length === 0) {
    return <p role="status">No command activity recorded for this import.</p>;
  }

  const activeCommands = commands.filter(active);
  const visibleCommands =
    activeCommands.length > 0 ? activeCommands : commands.slice(-1);

  return (
    <div role="status">
      {visibleCommands.map((command) => (
        <p key={command.id}>{commandStatus(command)}</p>
      ))}
    </div>
  );
}
