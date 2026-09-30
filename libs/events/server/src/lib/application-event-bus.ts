import type {
  ApplicationEvent,
  ApplicationEventFilter,
} from './application-event.js';

export type ApplicationEventListener = (event: ApplicationEvent) => void;

interface Subscription {
  readonly filter: ApplicationEventFilter;
  readonly listener: ApplicationEventListener;
}

const matches = (
  event: ApplicationEvent,
  filter: ApplicationEventFilter,
): boolean => {
  if (
    filter.commandId !== undefined &&
    (event.type === 'domain.invalidated' ||
      event.command.id !== filter.commandId)
  ) {
    return false;
  }

  if (
    filter.scope !== undefined &&
    (event.type !== 'domain.invalidated' || event.scope !== filter.scope)
  ) {
    return false;
  }

  return true;
};

export class ApplicationEventBus {
  private readonly subscriptions = new Set<Subscription>();

  publish(event: ApplicationEvent): void {
    for (const subscription of this.subscriptions) {
      if (!matches(event, subscription.filter)) {
        continue;
      }

      try {
        subscription.listener(event);
      } catch {
        // Observers are optional and must never interrupt authoritative work.
      }
    }
  }

  subscribe(
    filter: ApplicationEventFilter,
    listener: ApplicationEventListener,
  ): () => void {
    const subscription = { filter, listener };

    this.subscriptions.add(subscription);

    return () => {
      this.subscriptions.delete(subscription);
    };
  }

  close(): void {
    this.subscriptions.clear();
  }
}
