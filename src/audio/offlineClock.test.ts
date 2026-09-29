import { beforeAll, describe, expect, it, vi } from "vitest";
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

describe("createOfflineContext", () => {
  const RATE = 8_000;

  /** Gecko's native offline context, as Firefox ships it: no `suspend()`, and
   * an `AudioListener` with only the legacy setters, none of the `positionX`
   * params Tone's listener asserts on. */
  function stubGeckoOfflineAudioContext(): typeof OfflineAudioContext {
    const Native = globalThis.OfflineAudioContext;
    class GeckoOfflineAudioContext extends Native {
      get listener(): AudioListener {
        return { setPosition() {}, setOrientation() {} } as unknown as AudioListener;
      }
    }
    Object.defineProperty(GeckoOfflineAudioContext.prototype, "suspend", {
      value: undefined,
    });
    vi.stubGlobal("OfflineAudioContext", GeckoOfflineAudioContext);
    return GeckoOfflineAudioContext;
  }

  it("falls back to Tone's own context where the native one cannot suspend", async () => {
    const Gecko = stubGeckoOfflineAudioContext();
    try {
      const offline = clock.createOfflineContext(1, RATE, RATE);
      // What failed in Firefox: Tone initializes its listener with the transport.
      offline.transport.start(0);
      expect(offline.rawContext).not.toBeInstanceOf(Gecko);
      new Tone.Signal({ context: offline, value: 0.5 }).connect(offline.destination);
      const rendered = await clock.renderOfflineInStep(offline, { chunkSeconds: 0.25 });
      if (rendered === "stopped") throw new Error("expected audio");
      expect(rendered.length).toBe(RATE);
      expect(rendered.getChannelData(0)[RATE - 1]).toBeCloseTo(0.5, 6);
      offline.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("renderOfflineInStep", () => {
  const RATE = 8_000;

  it("pauses the audio at each chunk, where a node disposed then stops sounding", async () => {
    const offline = clock.createOfflineContext(1, 3 * RATE, RATE);
    const raw = offline.rawContext as unknown as OfflineAudioContext;
    expect(raw.length).toBe(3 * RATE);
    const source = new Tone.Signal({ context: offline, value: 0.5 });
    source.connect(offline.destination);
    const paused: { at: number; audio: number }[] = [];
    const rendered = await clock.renderOfflineInStep(offline, {
      chunkSeconds: 1,
      onRendered: (at) => {
        paused.push({ at, audio: raw.currentTime });
        if (paused.length === 1) source.dispose();
      },
    });
    if (rendered === "stopped") throw new Error("expected audio");

    // Each pause lands on the block at or before its chunk's end, with the
    // audio thread stopped exactly there.
    const block = 128 / RATE;
    expect(paused.map((p) => p.at)).toEqual([
      Math.floor(1 / block) * block,
      Math.floor(2 / block) * block,
    ]);
    for (const { at, audio } of paused) expect(audio).toBeCloseTo(at, 9);
    const data = rendered.getChannelData(0);
    const cut = Math.round(paused[0].at * RATE);
    expect(data[cut - 1]).toBeCloseTo(0.5, 6);
    expect(data.subarray(cut).every((sample) => sample === 0)).toBe(true);
    offline.dispose();
  });

  it("renders a context that cannot pause in one pass, after the clock", async () => {
    const offline = new Tone.OfflineContext(1, 2, RATE);
    const onRendered = vi.fn();
    const rendered = await clock.renderOfflineInStep(offline, {
      chunkSeconds: 0.5,
      onRendered,
    });
    expect(rendered).not.toBe("stopped");
    expect(onRendered).not.toHaveBeenCalled();
    offline.dispose();
  });

  it("stops or fails at a chunk mid-render, then finishes the render once asked", async () => {
    const fail = () => {
      throw new Error("boom");
    };
    for (const ending of ["stop", "onRendered", "clock"]) {
      const offline = clock.createOfflineContext(1, 3 * RATE, RATE);
      const raw = offline.rawContext as unknown as OfflineAudioContext;
      if (ending === "clock") offline.transport.schedule(fail, 1.5);
      offline.transport.start(0);
      const onRendered = vi.fn(ending === "onRendered" ? fail : () => {});
      const rendering = clock.renderOfflineInStep(offline, {
        chunkSeconds: 1,
        shouldStop: () => ending === "stop" && onRendered.mock.calls.length > 0,
        onRendered,
      });
      if (ending === "stop") expect(await rendering).toBe("stopped");
      else await expect(rendering).rejects.toThrow("boom");
      expect(onRendered).toHaveBeenCalledOnce();
      expect(raw.state).toBe("suspended");
      const complete = new Promise((resolve) =>
        raw.addEventListener("complete", resolve),
      );
      await clock.finishOfflineRender(offline);
      await complete;
      expect(raw.state).not.toBe("suspended");
      offline.dispose();
    }
  });
});
