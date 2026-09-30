import { describe, expect, it, vi } from "vitest";
import { libraryAsset, loopAsset } from "./__fixtures__/assets";
import { fakePreviewEngine } from "./__fixtures__/fakePreviewEngine";
import { AuditionController } from "./audition";
import type { LibraryAsset } from "./manifest";
import { type SlotAudition, slotPreviewEngine } from "./slotAudition";

/** A slot that records what it hears, and holds one-shots only, like the audio layer. */
function fakeSlot(playing = true) {
  const heard: (string | null)[] = [];
  const slot: SlotAudition & { heard: typeof heard; playing: boolean } = {
    heard,
    playing,
    preview: vi.fn((asset: LibraryAsset) => {
      const fits = asset.type !== "loop";
      heard.push(fits ? asset.id : null);
      return fits;
    }),
    clear: vi.fn(() => heard.push(null)),
    isPlaying: () => slot.playing,
  };
  return slot;
}

const kick = libraryAsset({ id: "kick" });
const snare = libraryAsset({ id: "snare" });

describe("slotPreviewEngine", () => {
  it("swaps a one-shot into a playing slot, and plays nothing standalone", async () => {
    const base = fakePreviewEngine();
    const slot = fakeSlot();
    const engine = slotPreviewEngine(base, slot, () => kick);

    await engine.start(kick, { sync: false });

    expect(slot.heard).toEqual(["kick"]);
    expect(base.starts).toHaveLength(0);
  });

  it("also plays standalone while the transport is stopped, so it is still heard", async () => {
    const base = fakePreviewEngine();
    const slot = fakeSlot(false);
    const engine = slotPreviewEngine(base, slot, () => kick);

    await engine.start(kick, { sync: false });

    expect(slot.heard).toEqual(["kick"]);
    expect(base.starts.map((start) => start.asset.id)).toEqual(["kick"]);
  });

  it("plays a loop through the base engine, synced, since a slot cannot hold one", async () => {
    const base = fakePreviewEngine();
    const slot = fakeSlot();
    const loop = loopAsset({ id: "loop", url: "/loop.wav" });
    const controller = new AuditionController(slotPreviewEngine(base, slot, () => loop));

    await controller.play(loop);

    expect(base.starts).toHaveLength(1);
    expect(base.starts[0].options.sync).toBe(true);
  });

  it("puts the slot back on the selected sound when a voice stops", async () => {
    const slot = fakeSlot();
    let selected: LibraryAsset | null = kick;
    const engine = slotPreviewEngine(fakePreviewEngine(), slot, () => selected);

    const voice = await engine.start(snare, { sync: false });
    voice.stop();
    voice.stop();
    expect(slot.heard).toEqual(["snare", "kick"]);

    selected = null;
    (await engine.start(snare, { sync: false })).stop();
    expect(slot.heard.at(-1)).toBeNull();
  });

  it("drops a sound that fails to load from the slot", async () => {
    const base = fakePreviewEngine();
    const slot = fakeSlot(false);
    const engine = slotPreviewEngine(base, slot, () => null);
    base.failNextWith("decode_failed");

    await expect(engine.start(kick, { sync: false })).rejects.toThrow();

    expect(slot.heard).toEqual(["kick", null]);
  });

  it("clears the override once on dispose, and touches the slot no more", async () => {
    const base = fakePreviewEngine();
    const slot = fakeSlot();
    const engine = slotPreviewEngine(base, slot, () => kick);
    const voice = await engine.start(snare, { sync: false });

    await engine.dispose();
    await engine.dispose();
    voice.stop();

    expect(slot.clear).toHaveBeenCalledTimes(1);
    expect(slot.heard).toEqual(["snare", null]);
    expect(base.disposed()).toBe(true);
  });
});
