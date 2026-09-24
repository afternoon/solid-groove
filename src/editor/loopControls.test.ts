import { describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { executeTransaction, type TransactionResult } from "../commands/execute";
import type { RawCommandInput } from "../commands/types";
import type { Project } from "../domain/entities";
import { createBlankProject } from "../domain/factories";
import { TICKS_PER_BAR } from "../domain/time";
import { memoryStorage } from "../testing/storage";
import { createLoopControls } from "./loopControls";

/** A session stand-in: real transactions, no autosave or Solid. */
function harness(options: { consent?: boolean } = {}) {
  let project: Project = createBlankProject({ ownerId: "user_1" });
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  if (options.consent === false) consent.set({ productAnalytics: false });
  const analytics = new Analytics({
    transport,
    consent,
    storage: memoryStorage(),
  });
  const dispatch = vi.fn(
    (
      commands: RawCommandInput | readonly RawCommandInput[],
    ): TransactionResult | undefined => {
      const result = executeTransaction(
        project,
        Array.isArray(commands) ? commands : [commands as RawCommandInput],
      );
      if (result.ok) project = result.project;
      return result;
    },
  );
  const controls = createLoopControls({
    project: () => project,
    dispatch,
    analytics,
  });
  return {
    controls,
    dispatch,
    events: () => transport.events,
    song: () => project.song,
  };
}

describe("loop controls (LOOP-017)", () => {
  it("moves the range through a command and reports its length once", () => {
    const h = harness();

    h.controls.setRange(TICKS_PER_BAR, TICKS_PER_BAR * 3);

    expect(h.song().loop.startTicks).toBe(TICKS_PER_BAR);
    expect(h.song().loop.endTicks).toBe(TICKS_PER_BAR * 3);
    const logged = h.events().filter((event) => event.name === "loop_range_set");
    expect(logged).toHaveLength(1);
    expect(logged[0].params.length_bars_bucket).toBe("2");
  });

  it("buckets the length the range actually became, not the raw drag", () => {
    const h = harness();

    // A drag that ends a tick into bar 5 encloses five bars once snapped.
    h.controls.setRange(0, TICKS_PER_BAR * 4 + 1);

    expect(h.song().loop.endTicks).toBe(TICKS_PER_BAR * 5);
    expect(h.events()[0].params.length_bars_bucket).toBe("5_8");
  });

  it("toggles looping off and on, reporting which way it went", () => {
    const h = harness();
    expect(h.controls.isEnabled()).toBe(true);

    h.controls.toggle();
    expect(h.controls.isEnabled()).toBe(false);
    h.controls.toggle();
    expect(h.controls.isEnabled()).toBe(true);

    const logged = h.events().filter((event) => event.name === "loop_enabled_set");
    expect(logged.map((event) => event.params.enabled)).toEqual([false, true]);
  });

  it("reports nothing when the edit does not commit", () => {
    const h = harness();
    h.dispatch.mockReturnValue(undefined);

    h.controls.setRange(0, TICKS_PER_BAR * 2);
    h.controls.setEnabled(false);

    expect(h.events()).toHaveLength(0);
  });

  it("changes nothing about the edit when analytics is disabled", () => {
    const h = harness({ consent: false });

    h.controls.setRange(TICKS_PER_BAR * 2, TICKS_PER_BAR * 4);
    h.controls.setEnabled(false);

    expect(h.song().loop).toEqual({
      startTicks: TICKS_PER_BAR * 2,
      endTicks: TICKS_PER_BAR * 4,
      enabled: false,
    });
    expect(h.events()).toHaveLength(0);
  });
});
