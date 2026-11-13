'use client';

import {
  commandEventSchema,
  commandStateSchema,
  type CommandState,
} from '@playlarr/commands-contracts';
import { useEffect, useState } from 'react';

const active = (command: CommandState): boolean =>
  command.status === 'queued' || command.status === 'running';

const newer = (
  current: CommandState | null | undefined,
  candidate: CommandState,
): CommandState =>
  current?.id === candidate.id && current.revision > candidate.revision
    ? current
    : candidate;

async function fetchCommand(url: string): Promise<CommandState | null> {
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Command status request failed with ${response.status}`);
  }

  const value: unknown = await response.json();

  return value === null ? null : commandStateSchema.parse(value);
}

export function ImportActivity({ importId }: { importId: string }) {
  const [command, setCommand] = useState<CommandState | null>();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let events: EventSource | undefined;

    const apply = (next: CommandState | null) => {
      if (!cancelled) {
        setCommand((current) => (next === null ? null : newer(current, next)));
        setUnavailable(false);
      }
    };

    const reconcile = async (url: string) => {
      try {
        const persisted = await fetchCommand(url);

        if (persisted !== null && !active(persisted)) {
          events?.close();
        }

        apply(persisted);
      } catch {
        if (!cancelled) {
          setUnavailable(true);
        }
      }
    };

    void (async () => {
      const query = new URLSearchParams({
        scope: 'imports',
        entityId: importId,
      });
      let initial: CommandState | null;

      try {
        initial = await fetchCommand(`/api/commands?${query.toString()}`);
      } catch {
        if (!cancelled) {
          setUnavailable(true);
        }
        return;
      }

      apply(initial);

      if (cancelled || initial === null || !active(initial)) {
        return;
      }

      events = new EventSource(
        `/api/events?${new URLSearchParams({ commandId: initial.id }).toString()}`,
      );

      const receive = (event: MessageEvent<string>) => {
        try {
          const parsed = commandEventSchema.parse(JSON.parse(event.data));
          apply(parsed.command);

          if (!active(parsed.command)) {
            events?.close();
          }
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
        void reconcile(`/api/commands/${encodeURIComponent(initial.id)}`);
      });
    })();

    return () => {
      cancelled = true;
      events?.close();
    };
  }, [importId]);

  if (unavailable) {
    return <p role="status">Activity status is temporarily unavailable.</p>;
  }

  if (command === undefined) {
    return <p role="status">Checking import activity…</p>;
  }

  if (command === null) {
    return <p role="status">No command activity recorded for this import.</p>;
  }

  if (command.status === 'queued') {
    return <p role="status">Background work is waiting to start.</p>;
  }

  if (command.status === 'completed') {
    return <p role="status">Background work completed.</p>;
  }

  if (command.status === 'failed') {
    return <p role="status">Background work failed.</p>;
  }

  const progress =
    command.total > 0 ? ` (${command.current}/${command.total})` : '';

  return (
    <p role="status">
      {command.currentItem ?? 'Background work in progress'}
      {progress}
    </p>
  );
}
