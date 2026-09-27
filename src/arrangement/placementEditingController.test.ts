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
    expect(h.editing.getArrangementSelection()).toEqual({
      kind: "clips",
      placementIds: [id],
    });
    // A dead clip is never reported as covered, even before reconciling.
    expect(h.editing.getSelection()).toEqual([]);
    h.editing.reconcile();
    expect(h.editing.getArrangementSelection()).toBeNull();
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

describe("paste anchor", () => {
  /**
   * Paste lands at the anchor the caller passes — the playhead, from
   * `edit.paste`. PR #285 briefly anchored it at the selection and dodged the
   * copy past its own source with a cascade walk; that walk is gone. Since #290
   * a track's placements are disjoint, and since #291 a paste overwrites what
   * it lands on, so pasting onto occupied ticks replaces, trims, or splits
   * what was there instead of stacking on it or being rejected.
   */
  it("pastes at the caller's anchor", () => {
    const h = harness();
    h.editing.select(h.placementId());
    h.editing.copy();

    h.editing.paste(TICKS_PER_BAR * 4);

    const pasted = h
      .getProject()
      .song.placements.find((p) => p.startTicks === TICKS_PER_BAR * 4);
    expect(pasted).toBeDefined();
  });

  it("pasting onto the copied source overwrites it instead of being rejected (#291)", () => {
    const h = harness();
    const source = h.getProject().song.placements[0];
    h.editing.select(source.id);
    h.editing.copy();

    expect(h.editing.paste(source.startTicks)).toBe(true);

    const placements = h.getProject().song.placements;
    expect(placements).toHaveLength(1);
    expect(placements[0].id).not.toBe(source.id);
    expect(placements[0].startTicks).toBe(source.startTicks);
    expect(placements[0].durationTicks).toBe(source.durationTicks);
  });
});
