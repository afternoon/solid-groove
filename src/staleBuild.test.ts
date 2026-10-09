import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "./shared/clock";
import { RELOAD_GUARD_MS, RELOAD_MARK, reloadOnStaleBuild } from "./staleBuild";
import { memoryStorage } from "./testing/storage";

function chunkFailure(): Event {
  return new Event("vite:preloadError", { cancelable: true });
}

function install(storage: Storage | null = memoryStorage()) {
  const target = new EventTarget();
  const reload = vi.fn();
  const clock = createManualClock(1_000_000);
  const dispose = reloadOnStaleBuild({ target, storage, reload, clock });
  return { target, reload, clock, storage, dispose };
}

describe("a tab left on an older build (GRV-26)", () => {
  it("reloads once when a route chunk fails to load, instead of showing an error", () => {
    const { target, reload, storage } = install();
    const event = chunkFailure();
    target.dispatchEvent(event);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(storage?.getItem(RELOAD_MARK)).toBe("1000000");
  });

  it("does not reload again straight after a reload, so a broken release cannot loop", () => {
    const { target, reload, clock } = install();
    target.dispatchEvent(chunkFailure());
    clock.advance(RELOAD_GUARD_MS - 1);
    const again = chunkFailure();
    target.dispatchEvent(again);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(again.defaultPrevented).toBe(false);
    clock.advance(1);
    target.dispatchEvent(chunkFailure());
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("leaves the error alone when there is nowhere to remember the reload", () => {
    const { target, reload } = install(null);
    const event = chunkFailure();
    target.dispatchEvent(event);
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening once torn down", () => {
    const { target, reload, dispose } = install();
    dispose();
    target.dispatchEvent(chunkFailure());
    expect(reload).not.toHaveBeenCalled();
  });
});
