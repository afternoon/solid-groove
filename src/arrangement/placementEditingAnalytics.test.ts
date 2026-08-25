/**
 * `ARR-002`'s analytics obligation (PRD OPS-02) plus the CLP-01 requirement it
 * measures: duplicating a placement is an explicit choice between reuse and an
 * independent variation, the UI names which it will perform, and
 * `placement_duplicated` records which one ran — once per action, with no
 * project, clip, or track name in its parameters.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { TICKS_PER_BAR } from "../domain/time";
import { createEditingHarness, eventsNamed } from "./placementEditingHarness";

describe("clipboard through the controller (ARR-01)", () => {
  it("copy, cut, and paste move placements through the clipboard", () => {
    const h = createEditingHarness();
    h.editing.select(h.placementId());
    expect(h.editing.copy()).toBe(true);
    expect(h.editing.getClipboard()).toHaveLength(1);

    expect(h.editing.paste(TICKS_PER_BAR * 4)).toBe(true);
    expect(h.getProject().song.placements).toHaveLength(2);

    h.editing.select(h.placementId());
    expect(h.editing.cut()).toBe(true);
    expect(h.getProject().song.placements).toHaveLength(1);
    expect(h.editing.getSelection()).toEqual([]);
  });

  it("pasting an empty clipboard does nothing", () => {
    const h = createEditingHarness();
    expect(h.editing.paste(0)).toBe(false);
  });
});

describe("duplicate names the operation it will perform (CLP-01)", () => {
  it("exposes a distinct label for each mode", () => {
    const h = createEditingHarness();
    expect(h.editing.duplicateLabel("linked")).not.toBe(
      h.editing.duplicateLabel("independent"),
    );
    expect(h.editing.duplicateLabel("linked")).toContain("linked");
    expect(h.editing.duplicateLabel("independent")).toContain("independent");
  });

  it("a linked duplicate reuses the clip; an independent one forks it", () => {
    const linked = createEditingHarness();
    linked.editing.select(linked.placementId());
    linked.editing.duplicate("linked");
    expect(linked.getProject().clips).toHaveLength(1);

    const forked = createEditingHarness();
    forked.editing.select(forked.placementId());
    forked.editing.duplicate("independent");
    expect(forked.getProject().clips).toHaveLength(2);
  });

  it("selects what it just created, so the next gesture acts on the copy", () => {
    const h = createEditingHarness();
    const source = h.placementId();
    h.editing.select(source);
    h.editing.duplicate("linked");
    const selection = h.editing.getSelection();
    expect(selection).toHaveLength(1);
    expect(selection[0]).not.toBe(source);
  });
});

describe("analytics (PRD OPS-02)", () => {
  let harnessed: ReturnType<typeof createEditingHarness>;

  beforeEach(() => {
    harnessed = createEditingHarness();
  });

  it("logs placement_duplicated exactly once per duplicate action", () => {
    harnessed.editing.select(harnessed.placementId());
    harnessed.editing.duplicate("linked");

    const events = eventsNamed(harnessed.transport, "placement_duplicated");
    expect(events).toHaveLength(1);
    expect(events[0].params.mode).toBe("linked");
  });

  it("records which of the two operations ran", () => {
    harnessed.editing.select(harnessed.placementId());
    harnessed.editing.duplicate("independent");
    const events = eventsNamed(harnessed.transport, "placement_duplicated");
    expect(events).toHaveLength(1);
    expect(events[0].params.mode).toBe("independent");
  });

  it("does not log when the duplicate produced no commands", () => {
    // Nothing selected, so there is no action to measure.
    harnessed.editing.duplicate("linked");
    expect(eventsNamed(harnessed.transport, "placement_duplicated")).toEqual([]);
  });

  it("carries no project, clip, or track name in its parameters", () => {
    harnessed.editing.select(harnessed.placementId());
    harnessed.editing.duplicate("linked");
    const [event] = eventsNamed(harnessed.transport, "placement_duplicated");
    expect(Object.keys(event.params)).toContain("mode");
    const values = JSON.stringify(event.params);
    expect(values).not.toContain("Four on the floor");
    expect(values).not.toContain("Slice fixture");
    expect(values).not.toContain("BD");
  });

  it("disabling analytics changes nothing about the edit itself", () => {
    const off = createEditingHarness({ analyticsAllowed: false });
    off.editing.select(off.placementId());
    expect(off.editing.duplicate("independent")).toBe(true);
    // The edit still lands...
    expect(off.getProject().clips).toHaveLength(2);
    // ...and nothing is sent.
    expect(eventsNamed(off.transport, "placement_duplicated")).toEqual([]);
  });
});
