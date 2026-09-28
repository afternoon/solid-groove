import type { NoteTrigger } from "../domain/entities";
import type { TrackId } from "../domain/ids";

/** Stops one subscription. Calling it twice is harmless. */
export type Unsubscribe = () => void;

/**
 * The one place a view learns what the audio graph is playing (#447).
 *
 * The graph publishes each instrument trigger as it schedules it, with how far
 * ahead of the audio clock that is; the feed holds the subscriptions and hands
 * each trigger to the subscribers for its track once it is heard. Neither side
 * knows the other: the graph never sees a subscriber, and a subscriber never
 * sees the graph, a Tone node, or an audio time — only a domain trigger.
 *
 * Subscriptions are the feed's to manage: an unsubscribe also cancels any
 * delivery still waiting for that subscriber, and `dispose` cancels them all,
 * so no callback runs into a view that has gone.
 */
export interface TriggerFeed {
  /** Follows one track's triggers as they are heard. */
  subscribe(trackId: TrackId, onTrigger: (trigger: NoteTrigger) => void): Unsubscribe;
  /** Reports a trigger `delaySeconds` before it sounds. */
  publish(trackId: TrackId, trigger: NoteTrigger, delaySeconds: number): void;
  /** Cancels every waiting delivery; subscribers stay subscribed. */
  cancelPending(): void;
  /** Cancels everything and drops every subscriber. */
  dispose(): void;
}

interface Subscriber {
  readonly trackId: TrackId;
  readonly onTrigger: (trigger: NoteTrigger) => void;
  readonly pending: Set<ReturnType<typeof setTimeout>>;
}

export function createTriggerFeed(): TriggerFeed {
  const subscribers = new Set<Subscriber>();

  function cancel(subscriber: Subscriber): void {
    for (const timer of subscriber.pending) clearTimeout(timer);
    subscriber.pending.clear();
  }

  return {
    subscribe(trackId, onTrigger) {
      const subscriber: Subscriber = { trackId, onTrigger, pending: new Set() };
      subscribers.add(subscriber);
      return () => {
        cancel(subscriber);
        subscribers.delete(subscriber);
      };
    },
    publish(trackId, trigger, delaySeconds) {
      for (const subscriber of subscribers) {
        if (subscriber.trackId !== trackId) continue;
        const timer = setTimeout(() => {
          subscriber.pending.delete(timer);
          subscriber.onTrigger(trigger);
        }, Math.max(0, delaySeconds) * 1000);
        subscriber.pending.add(timer);
      }
    },
    cancelPending() {
      for (const subscriber of subscribers) cancel(subscriber);
    },
    dispose() {
      for (const subscriber of subscribers) cancel(subscriber);
      subscribers.clear();
    },
  };
}
