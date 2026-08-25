// Shared deferred-work abstraction.
//
// Anything that coalesces rapid activity (autosave batching, retry backoff)
// depends on a `Scheduler` rather than calling `setTimeout` directly, so tests
// drive time explicitly instead of sleeping. It sits beside `clock.ts` for the
// same reason: production code is a consumer too, not just tests.

export type CancelScheduled = () => void;

export interface Scheduler {
  /** Runs `callback` after `delayMs`, returning a cancel handle. */
  schedule(callback: () => void, delayMs: number): CancelScheduled;
}

/** The real scheduler. Use this everywhere outside tests. */
export const timeoutScheduler: Scheduler = {
  schedule(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};

export interface ManualScheduler extends Scheduler {
  /** Number of callbacks waiting to run. */
  readonly pending: number;
  /** Runs every callback whose delay has elapsed after advancing by `ms`. */
  advance(ms: number): void;
  /** Runs every pending callback immediately, regardless of its delay. */
  runAll(): void;
}

/**
 * A deterministic scheduler for tests. Nothing runs until the test advances it,
 * so "rapid writes are coalesced" can be asserted without real timers.
 */
export function createManualScheduler(): ManualScheduler {
  let now = 0;
  let nextId = 0;
  const tasks = new Map<number, { at: number; callback: () => void }>();

  const due = (limit: number) =>
    [...tasks.entries()]
      .filter(([, task]) => task.at <= limit)
      .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);

  return {
    get pending() {
      return tasks.size;
    },
    schedule(callback, delayMs) {
      const id = nextId++;
      tasks.set(id, { at: now + delayMs, callback });
      return () => tasks.delete(id);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, task] of due(now)) {
        tasks.delete(id);
        task.callback();
      }
    },
    runAll() {
      for (const [id, task] of due(Number.POSITIVE_INFINITY)) {
        tasks.delete(id);
        task.callback();
      }
    },
  };
}
