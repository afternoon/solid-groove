import { beforeAll, describe, expect, it } from "vitest";
import { createManualScheduler } from "../shared/scheduler";
import { installWebAudioGlobals } from "./testAudioContext";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let Tone: typeof import("tone");
let clock: typeof import("./offlineClock");

beforeAll(async () => {
  Tone = await import("tone");
  clock = await import("./offlineClock");
});

describe("withGlobalContext", () => {
  it("installs the context for the work and restores the previous one after", () => {
    const live = Tone.getContext();
    const offline = new Tone.OfflineContext(1, 0.1, 44_100);
    const seen = clock.withGlobalContext(offline, () => Tone.getContext());
    expect(seen).toBe(offline);
    expect(Tone.getContext()).toBe(live);
  });

  it("restores the previous context when the work throws", () => {
    const live = Tone.getContext();
    const offline = new Tone.OfflineContext(1, 0.1, 44_100);
    expect(() =>
      clock.withGlobalContext(offline, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(Tone.getContext()).toBe(live);
  });

  it("refuses async work, which would hold the swap across a yield", () => {
    const live = Tone.getContext();
    const offline = new Tone.OfflineContext(1, 0.1, 44_100);
    expect(() => clock.withGlobalContext(offline, async () => 1)).toThrow(/synchronous/);
    expect(Tone.getContext()).toBe(live);
  });
});

describe("advanceOfflineClock", () => {
  it("fires a transport event at its exact time, building its nodes in the offline context", () => {
    const live = Tone.getContext();
    const offline = new Tone.OfflineContext(1, 1, 44_100);
    const fired: { time: number; nodeContext: unknown }[] = [];
    offline.transport.schedule((time) => {
      // What an instrument voice does inside a scheduled callback.
      const gain = new Tone.Gain(1);
      fired.push({ time, nodeContext: gain.context });
      gain.dispose();
    }, 0.5);
    offline.transport.start(0);

    expect(clock.advanceOfflineClock(offline, 0.25)).toBe(false);
    expect(fired).toEqual([]);
    // Tone's public clock reads the same private field this module steps.
    expect(offline.currentTime).toBeGreaterThan(0.25);
    expect(offline.currentTime).toBeLessThan(0.25 + 2 * (128 / 44_100));

    expect(clock.advanceOfflineClock(offline, 10)).toBe(true);
    expect(fired).toHaveLength(1);
    expect(fired[0].time).toBeCloseTo(0.5, 9);
    expect(fired[0].nodeContext).toBe(offline);
    expect(Tone.getContext()).toBe(live);
    offline.dispose();
  });
});

describe("runOfflineClock", () => {
  it("runs in chunks, with the live context back in place at every yield", async () => {
    const live = Tone.getContext();
    const offline = new Tone.OfflineContext(1, 2, 8_000);
    const scheduler = createManualScheduler();
    const progress: number[] = [];
    const contextsAtYield: unknown[] = [];

    const running = clock.runOfflineClock(offline, {
      chunkSeconds: 0.5,
      scheduler,
      onProgress: (fraction) => progress.push(fraction),
    });
    let settled = false;
    void running.then(() => {
      settled = true;
    });
    for (let turns = 0; !settled && turns < 50; turns++) {
      if (scheduler.pending > 0) {
        contextsAtYield.push(Tone.getContext());
        scheduler.runAll();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await expect(running).resolves.toBe("done");

    expect(progress).toEqual([0.25, 0.5, 0.75, 1]);
    expect(contextsAtYield.length).toBeGreaterThan(0);
    for (const context of contextsAtYield) expect(context).toBe(live);
    offline.dispose();
  });

  it("stops before the next chunk when asked to", async () => {
    const offline = new Tone.OfflineContext(1, 2, 8_000);
    let chunks = 0;
    const result = await clock.runOfflineClock(offline, {
      chunkSeconds: 0.5,
      shouldStop: () => chunks >= 2,
      onProgress: () => {
        chunks++;
      },
    });
    expect(result).toBe("stopped");
    expect(chunks).toBe(2);
    expect(offline.currentTime).toBeLessThan(1.1);
    offline.dispose();
  });
});
