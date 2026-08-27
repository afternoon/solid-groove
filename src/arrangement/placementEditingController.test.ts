import { describe, expect, it } from "vitest";
import { TICKS_PER_BAR } from "../domain/time";
import { createEditingHarness as harness } from "./placementEditingHarness";

describe("selection", () => {
  it("selects one placement and replaces the selection by default", () => {
    const h = harness();
    const first = h.placementId();
    h.editing.select(first);
    expect(h.editing.getSelection()).toEqual([first]);
    expect(h.editing.hasSelection()).toBe(true);

    h.editing.duplicate("linked");
    const second = h.getProject().song.placements[1].id;
    h.editing.select(second);
    expect(h.editing.getSelection()).toEqual([second]);
  });

  it("additive selection toggles a placement in and out", () => {
    const h = harness();
    const first = h.placementId();
    h.editing.select(first);
    h.editing.duplicate("linked");
    const second = h.getProject().song.placements[1].id;

    h.editing.select(first);
    h.editing.select(second, true);
    expect(h.editing.getSelection()).toHaveLength(2);
    h.editing.select(second, true);
    expect(h.editing.getSelection()).toEqual([first]);
  });

  it("reconcile drops IDs the project no longer contains", () => {
    const h = harness();
    const id = h.placementId();
    h.editing.select(id);
    h.editing.deleteSelection();
    // Re-select the now-deleted ID, as a stale selection surviving an undo
    // would; reconcile against the live project must drop it.
    h.editing.select(id);
    expect(h.editing.getSelection()).toEqual([id]);
    h.editing.reconcile();
    expect(h.editing.getSelection()).toEqual([]);
  });
});

describe("drag: move and resize commit as one gesture", () => {
  it("a multi-step move commits exactly one gesture", () => {
    const h = harness();
    const id = h.placementId();
    h.editing.beginDrag(id, "body", 0);
    h.editing.updateDrag(TICKS_PER_BAR);
    h.editing.updateDrag(TICKS_PER_BAR * 2);
    h.editing.updateDrag(TICKS_PER_BAR * 3);
    h.editing.endDrag();

    expect(h.gestures.commits).toBe(1);
    expect(h.gestures.cancels).toBe(0);
    expect(h.getProject().song.placements[0].startTicks).toBe(TICKS_PER_BAR * 3);
    expect(h.editing.isDragging()).toBe(false);
  });

  it("a drag that never moved cancels rather than committing an empty entry", () => {
    const h = harness();
    h.editing.beginDrag(h.placementId(), "body", 0);
    h.editing.endDrag();
    expect(h.gestures.commits).toBe(0);
    expect(h.gestures.cancels).toBe(1);
  });

  it("cancelDrag abandons the gesture", () => {
    const h = harness();
    h.editing.beginDrag(h.placementId(), "body", 0);
    h.editing.updateDrag(TICKS_PER_BAR * 2);
    h.editing.cancelDrag();
    expect(h.gestures.cancels).toBe(1);
    expect(h.editing.isDragging()).toBe(false);
  });

  it("dragging the end handle resizes instead of moving", () => {
    const h = harness();
    const id = h.placementId();
    h.editing.beginDrag(id, "end", TICKS_PER_BAR);
    h.editing.updateDrag(TICKS_PER_BAR * 4);
    h.editing.endDrag();
    const placement = h.getProject().song.placements[0];
    expect(placement.startTicks).toBe(0);
    expect(placement.durationTicks).toBe(TICKS_PER_BAR * 4);
  });

  it("beginning a drag selects the placement being dragged", () => {
    const h = harness();
    const id = h.placementId();
    h.editing.beginDrag(id, "body", 0);
    expect(h.editing.getSelection()).toEqual([id]);
  });
});

describe("discrete operations", () => {
  it("deletes the selection and clears it", () => {
    const h = harness();
    h.editing.select(h.placementId());
    expect(h.editing.deleteSelection()).toBe(true);
    expect(h.getProject().song.placements).toHaveLength(0);
    expect(h.editing.getSelection()).toEqual([]);
  });

  it("delete with nothing selected does nothing", () => {
    const h = harness();
    expect(h.editing.deleteSelection()).toBe(false);
    expect(h.getProject().song.placements).toHaveLength(1);
  });

  it("toggles the loop flag on the selection", () => {
    const h = harness();
    h.editing.select(h.placementId());
    expect(h.editing.toggleLoop()).toBe(true);
    expect(h.getProject().song.placements[0].looped).toBe(true);
    expect(h.editing.toggleLoop()).toBe(true);
    expect(h.getProject().song.placements[0].looped).toBe(false);
  });
});

describe("paste anchor (#258)", () => {
  /**
   * Reported from the preview: with a placement selected at bar 2 and the
   * playhead at bar 1, paste landed at bar 1. The playhead is the right anchor
   * only "with no explicit target selected", which the handler's own comment
   * says — a live selection *is* that explicit target, and `edit.paste`
   * declares `ableton: { kind: "follows" }`, where Ableton pastes at the
   * selection. Verified against Ableton by the reporter.
   */
  it("pastes at the selection, not the playhead, when something is selected", () => {
    const h = harness();
    const first = h.placementId();
    h.editing.select(first);
    h.editing.copy();

    // The playhead is somewhere else entirely.
    h.editing.paste(TICKS_PER_BAR * 4);

    const placements = h.getProject().song.placements;
    expect(placements).toHaveLength(2);
    const source = placements.find((p) => p.id === first);
    if (!source) throw new Error("the copied placement is gone");
    const pasted = placements.find((p) => p.id !== first);
    // Anchored to the selection at bar 1, not the playhead at bar 5 — and
    // immediately *after* its own source rather than on top of it. The
    // preview showed the stacked version: "Copying a clip then pasting it
    // results in 2 clips at the current location."
    expect(pasted?.startTicks).toBe(source.startTicks + source.durationTicks);
  });

  it("cascades a repeated paste rather than stacking copies", () => {
    const h = harness();
    h.editing.select(h.placementId());
    h.editing.copy();

    h.editing.paste(TICKS_PER_BAR * 4);
    h.editing.paste(TICKS_PER_BAR * 4);

    const starts = h.getProject().song.placements.map((p) => p.startTicks);
    expect(starts).toHaveLength(3);
    expect(new Set(starts).size).toBe(3);
  });

  it("still pastes at the caller's anchor when nothing is selected", () => {
    const h = harness();
    h.editing.select(h.placementId());
    h.editing.copy();
    h.editing.clearSelection();

    h.editing.paste(TICKS_PER_BAR * 4);

    const pasted = h
      .getProject()
      .song.placements.find((p) => p.startTicks === TICKS_PER_BAR * 4);
    expect(pasted).toBeDefined();
  });
});
