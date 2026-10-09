import { type Clock, systemClock } from "./shared/clock";

/**
 * A tab that outlives a deploy (GRV-26's QA: an assistant panel from the
 * build before, after an in-app navigation) asks for route chunks that the
 * new release no longer has. Vite reports each such failed import as a
 * `vite:preloadError` on the window; this reloads the page once, so the tab
 * picks up the current shell and its chunks instead of showing an error or a
 * stale page.
 *
 * A reload that fails the same way within {@link RELOAD_GUARD_MS} is not
 * repeated: the error then goes on to the route's error boundary, rather than
 * the tab reloading forever against a release that is genuinely broken.
 */
export const RELOAD_MARK = "groove:stale-build-reload";

/** How long after a reload a second failed chunk is left alone. */
export const RELOAD_GUARD_MS = 10_000;

export interface StaleBuildOptions {
  readonly target?: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly storage?: Storage | null;
  readonly reload?: () => void;
  readonly clock?: Clock;
}

/** Installs the reload; returns its teardown. */
export function reloadOnStaleBuild(options: StaleBuildOptions = {}): () => void {
  const target = options.target ?? window;
  const storage = options.storage === undefined ? safeSessionStorage() : options.storage;
  const reload = options.reload ?? (() => window.location.reload());
  const clock = options.clock ?? systemClock;

  const onPreloadError = (event: Event) => {
    // Without somewhere to remember the reload there is no guard against a
    // loop, so the error is left to the error boundary.
    if (!storage) return;
    const now = clock.now();
    const last = Number(storage.getItem(RELOAD_MARK) ?? Number.NaN);
    if (Number.isFinite(last) && now - last < RELOAD_GUARD_MS) return;
    storage.setItem(RELOAD_MARK, String(now));
    event.preventDefault();
    reload();
  };
  target.addEventListener("vite:preloadError", onPreloadError);
  return () => target.removeEventListener("vite:preloadError", onPreloadError);
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
