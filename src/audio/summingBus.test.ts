import { beforeAll, describe, expect, it } from "vitest";
import { installWebAudioGlobals } from "./testAudioContext";

installWebAudioGlobals();

let Tone: typeof import("tone");
let SummingBus: typeof import("./summingBus").SummingBus;

beforeAll(async () => {
  Tone = await import("tone");
  ({ SummingBus } = await import("./summingBus"));
});

/** Renders `build` offline and returns the last sample of the first channel. */
async function settledLevel(
  build: (destination: import("tone").ToneAudioNode) => void,
): Promise<number> {
  const rendered = await Tone.Offline(({ destination }) => build(destination), 0.01);
  const samples = rendered.getChannelData(0);
  return samples[samples.length - 1] ?? 0;
}

describe("SummingBus", () => {
  it("sums every source it is given", async () => {
    const level = await settledLevel((destination) => {
      const bus = new SummingBus();
      bus.output.connect(destination);
      for (const value of [0.1, 0.2, 0.3, 0.25]) bus.add(new Tone.Signal(value));
      expect(bus.size).toBe(4);
    });
    expect(level).toBeCloseTo(0.85, 5);
  });

  it("keeps summing the rest when a source in the middle is detached", async () => {
    const level = await settledLevel((destination) => {
      const bus = new SummingBus();
      bus.output.connect(destination);
      bus.add(new Tone.Signal(0.1));
      const detach = bus.add(new Tone.Signal(0.2));
      bus.add(new Tone.Signal(0.3));
      detach();
      expect(bus.size).toBe(2);
    });
    expect(level).toBeCloseTo(0.4, 5);
  });

  it("keeps summing when the first or the last source is detached", async () => {
    const level = await settledLevel((destination) => {
      const bus = new SummingBus();
      bus.output.connect(destination);
      const first = bus.add(new Tone.Signal(0.1));
      bus.add(new Tone.Signal(0.2));
      const last = bus.add(new Tone.Signal(0.3));
      first();
      last();
      // A source added after the old last one was removed joins the chain.
      bus.add(new Tone.Signal(0.05));
    });
    expect(level).toBeCloseTo(0.25, 5);
  });

  it("detaches once, even after the source itself is disposed", async () => {
    const level = await settledLevel((destination) => {
      const bus = new SummingBus();
      bus.output.connect(destination);
      bus.add(new Tone.Signal(0.1));
      const source = new Tone.Signal(0.2);
      const detach = bus.add(source);
      source.dispose();
      expect(() => detach()).not.toThrow();
      expect(() => detach()).not.toThrow();
      expect(bus.size).toBe(1);
    });
    expect(level).toBeCloseTo(0.1, 5);
  });

  it("disposes every stage, and a detach after that is a no-op", () => {
    const bus = new SummingBus();
    const detach = bus.add(new Tone.Signal(0.1));
    bus.add(new Tone.Signal(0.2));
    bus.dispose();
    bus.dispose();
    expect(bus.output.disposed).toBe(true);
    expect(bus.size).toBe(0);
    expect(() => detach()).not.toThrow();
  });
});
