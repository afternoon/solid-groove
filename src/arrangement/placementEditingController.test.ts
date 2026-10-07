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

  it("dragging the end handle past the end repeats instead of moving (#493)", () => {
    const h = harness();
    const id = h.placementId();
    h.editing.beginDrag(id, "end", TICKS_PER_BAR);
    h.editing.updateDrag(TICKS_PER_BAR * 4);
    h.editing.endDrag();
    const [placement, ...copies] = h.getProject().song.placements;
    expect(placement.startTicks).toBe(0);
    expect(placement.durationTicks).toBe(TICKS_PER_BAR);
    expect(copies.map((p) => p.startTicks)).toEqual([
      TICKS_PER_BAR,
      TICKS_PER_BAR * 2,
      TICKS_PER_BAR * 3,
    ]);
  });

  it("a repeat drag selects the clip and its copies, so the outline covers them (GRV-65)", () => {
    const h = harness();
    const id = h.placementId();
    h.editing.select(id);
    h.editing.beginDrag(id, "end", TICKS_PER_BAR);
    h.editing.updateDrag(TICKS_PER_BAR * 3);
    const all = h.getProject().song.placements.map((p) => p.id);
    // Mid-drag, the outline already follows the copies the drop would make.
    expect(h.editing.getSelection()).toEqual(all);
    h.editing.endDrag();
    expect(h.getProject().song.placements.map((p) => p.id)).toEqual(all);
    expect(h.editing.getSelection()).toEqual(all);
  });

  it("undo and redo of a repeat drag keep the selection on what exists (GRV-65)", () => {
    const h = harness();
    const id = h.placementId();
    const before = h.getProject();
    h.editing.select(id);
    h.editing.beginDrag(id, "end", TICKS_PER_BAR);
    h.editing.updateDrag(TICKS_PER_BAR * 3);
    h.editing.endDrag();
    const after = h.getProject();
    const all = after.song.placements.map((p) => p.id);

    h.setProject(before); // undo
    h.editing.reconcile();
    expect(h.editing.getSelection()).toEqual([id]);

    h.setProject(after); // redo
    h.editing.reconcile();
    expect(h.editing.getSelection()).toEqual(all);
  });

  it("cancelling a repeat drag puts the selection back (GRV-65)", () => {
    const h = harness();
    const id = h.placementId();
    h.editing.select(id);
    h.editing.beginDrag(id, "end", TICKS_PER_BAR);
    h.editing.updateDrag(TICKS_PER_BAR * 3);
    h.editing.cancelDrag();
    expect(h.editing.getArrangementSelection()).toEqual({
      kind: "clips",
      placementIds: [id],
    });
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

describe("resizing the selection from the keyboard (#76)", () => {
  it("moves the selected clip's end a bar either way, never under a bar", () => {
    const h = harness();
    const id = h.placementId();
    const before = h.getProject().song.placements[0].durationTicks;
    h.editing.select(id);
    expect(h.editing.resizeSelection("end", 1)).toBe(true);
    expect(h.getProject().song.placements[0].durationTicks).toBe(before + TICKS_PER_BAR);
    expect(h.editing.resizeSelection("end", -1)).toBe(true);
    expect(h.getProject().song.placements[0].durationTicks).toBe(before);
    // Shortening stops at one bar.
    while (h.editing.resizeSelection("end", -1)) {
      /* down to the floor */
    }
    expect(h.getProject().song.placements[0].durationTicks).toBe(TICKS_PER_BAR);
    expect(h.editing.getSelection()).toEqual([id]);
  });

  it("moves the start edge as its drag does, trimming the clip's head", () => {
    const h = harness();
    const id = h.placementId();
    h.editing.select(id);
    h.editing.resizeSelection("end", 1);
    const before = h.getProject().song.placements[0];
    expect(h.editing.resizeSelection("start", 1)).toBe(true);
    const after = h.getProject().song.placements[0];
    expect(after.startTicks).toBe(before.startTicks + TICKS_PER_BAR);
    expect(after.durationTicks).toBe(before.durationTicks - TICKS_PER_BAR);
    expect(after.clipOffsetTicks).toBe(before.clipOffsetTicks + TICKS_PER_BAR);
    // And back: the start rewinds over what it trimmed.
    expect(h.editing.resizeSelection("start", -1)).toBe(true);
    expect(h.getProject().song.placements[0]).toEqual(before);
  });

  it("does nothing with nothing selected", () => {
    const h = harness();
    const before = h.getProject();
    expect(h.editing.resizeSelection("end", 1)).toBe(false);
    expect(h.getProject()).toBe(before);
  });

  it("logs its feature_first_use once", () => {
    const h = harness();
    h.editing.select(h.placementId());
    h.editing.resizeSelection("end", 1);
    h.editing.resizeSelection("end", 1);
    const firstUses = h.transport.events.filter(
      (event) =>
        event.name === "feature_first_use" &&
        event.params.feature === "arrangement_clip_resize",
    );
    expect(firstUses).toHaveLength(1);
  });
});

describe("paste anchor", () => {
  /**
   * With nothing selected, paste lands at the anchor the caller passes (the
   * playhead, from `edit.paste`), snapped to a bar. With a selection it lands
   * at the selection's start instead (#292, `placementEditingPaste.test.ts`).
   * Since #290 a track's placements are disjoint, and since #291 a paste
   * overwrites what it lands on, so pasting onto occupied ticks replaces,
   * trims, or splits what was there instead of stacking on it or being
   * rejected.
   */
  it("pastes at the caller's anchor, snapped, when nothing is selected", () => {
    const h = harness();
    h.editing.select(h.placementId());
    h.editing.copy();
    h.editing.clearSelection();

    h.editing.paste(TICKS_PER_BAR * 4 + 100);

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
