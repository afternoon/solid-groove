// `Storage` doubles for tests (helpers only tests use).
//
// Telemetry consent, once-only analytics events, and the internal-traffic flag
// all persist through a `Storage`. Every one of them takes the store by
// injection so a test never shares jsdom's real `localStorage` with another
// test — a leaked opt-out or a leaked "already fired" marker makes suites pass
// or fail depending on their order.

/** An isolated in-memory `Storage`. */
export function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  } as Storage;
}

/**
 * A `Storage` whose every operation throws.
 *
 * Not a contrived case: Safari's private browsing and a full quota both make
 * `localStorage` throw on access. PRD `OPS-02` requires telemetry to fail open,
 * so every consumer has to survive this.
 */
export function hostileStorage(): Storage {
  const boom = (): never => {
    throw new Error("storage disabled");
  };
  return {
    get length(): number {
      return boom();
    },
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  } as unknown as Storage;
}
