import { describe, expect, it } from "vitest";
import type { TrackId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { pointSelection } from "../selection";
import { buildArrangementProject } from "../testing/arrangementProject";
import { createEditingHarness, eventsNamed } from "./placementEditingHarness";

const BAR = TICKS_PER_BAR;

/**
 * The controller holding the arrangement's one selection (#292), over CF-010's
 * layout: BD has clips in bars 1 and 3, the second track one across bars 1-3.
 */
function cf010(options: { analyticsAllowed?: boolean } = {}) {
  const built = buildArrangementProject([
    [
      { startTicks: 0, durationTicks: BAR },
      { startTicks: 2 * BAR, durationTicks: BAR },
    ],
    [{ startTicks: 0, durationTicks: 3 * BAR }],
  ]);
  const h = createEditingHarness({ ...options, project: built.project });
  const [bd, second] = built.trackIds;
  return { h, bd, second, ...built };
}

/** CF-010 step 2's drag: from 2.3.1 on BD to 4.3.1 on the second track. */
function dragAcross(h: ReturnType<typeof cf010>["h"], bd: TrackId, second: TrackId) {
  h.editing.beginBand({ trackId: bd, ticks: 1164 });
  h.editing.updateBand({ trackId: second, ticks: 2000 });
  h.editing.updateBand({ trackId: second, ticks: 2700 });
  return h.editing.endBand();
}

describe("the drag band (#292)", () => {
  it("selects every clip it touched, as whole clips, on release (CF-010)", () => {
    const { h, bd, second, placementIds } = cf010();
    expect(dragAcross(h, bd, second)).toBe(true);
    // BD's bar-3 clip, wholly inside, and the overlapped clip on track 2.
    expect(h.editing.getSelection()).toEqual([placementIds[0][1], placementIds[1][0]]);
    expect(h.editing.getArrangementSelection()?.kind).toBe("clips");
    expect(h.editing.getBand()).toBeNull();
    expect(h.editing.isBanding()).toBe(false);
  });

  it("shows the band and what it touches while it moves, and lets go of the old selection", () => {
    const { h, bd, second, placementIds } = cf010();
    h.editing.select(placementIds[0][0]);
    h.editing.beginBand({ trackId: bd, ticks: 1164 });
    // A press alone changes nothing: it may still be a click.
    expect(h.editing.getSelection()).toEqual([placementIds[0][0]]);
    h.editing.updateBand({ trackId: second, ticks: 2700 });
    expect(h.editing.getBand()).toEqual({
      trackIds: [bd, second],
      startTicks: 1164,
      endTicks: 2700,
    });
    expect(h.editing.bandPlacementIds()).toEqual([
      placementIds[0][1],
      placementIds[1][0],
    ]);
    expect(h.editing.getArrangementSelection()).toBeNull();
  });

  it("selects nothing when it touched no clip (CF-009 step 4)", () => {
    const { h, bd, placementIds } = cf010();
    h.editing.select(placementIds[0][0]);
    h.editing.beginBand({ trackId: bd, ticks: BAR + 60 });
    h.editing.updateBand({ trackId: bd, ticks: 2 * BAR - 60 });
    expect(h.editing.endBand()).toBe(true);
    expect(h.editing.getArrangementSelection()).toBeNull();
  });

  it("reports a press that never moved, so the caller can treat it as a click", () => {
    const { h, bd } = cf010();
    h.editing.beginBand({ trackId: bd, ticks: 4.5 * BAR });
    expect(h.editing.endBand()).toBe(false);
    h.editing.placePoint({ trackId: bd, ticks: 4.5 * BAR });
    expect(h.editing.getArrangementSelection()).toEqual(
      pointSelection({ trackId: bd, ticks: 4 * BAR }),
    );
  });

  it("gives a point no clips to act on, so no edit runs from it", () => {
    const { h, bd } = cf010();
    h.editing.placePoint({ trackId: bd, ticks: 5 * BAR });
    const before = h.getProject();
    expect(h.editing.hasSelection()).toBe(false);
    expect(h.editing.selectionSpan()).toBeNull();
    expect(h.editing.deleteSelection()).toBe(false);
    expect(h.editing.copy()).toBe(false);
    expect(h.getProject()).toBe(before);
  });

  it("deletes the band's clips whole, trimming nothing (CF-010 step 3)", () => {
    const { h, bd, second, placementIds } = cf010();
    dragAcross(h, bd, second);
    expect(h.editing.selectionSpan()).toEqual({ startTicks: 0, endTicks: 3 * BAR });
    expect(h.editing.deleteSelection()).toBe(true);
    expect(
      h.getProject().song.placements.map((p) => [p.id, p.startTicks, p.durationTicks]),
    ).toEqual([[placementIds[0][0], 0, BAR]]);
    expect(h.editing.getArrangementSelection()).toBeNull();
  });

  it("copies and cuts the band's clips whole", () => {
    const { h, bd, second } = cf010();
    dragAcross(h, bd, second);
    expect(h.editing.copy()).toBe(true);
    expect(
      h.editing.getClipboard().map((entry) => [entry.startTicks, entry.durationTicks]),
    ).toEqual([
      [2 * BAR, BAR],
      [0, 3 * BAR],
    ]);
    expect(h.editing.cut()).toBe(true);
    expect(h.getProject().song.placements).toHaveLength(1);
  });

  it("narrows to one clip clicked inside the selection, but keeps it for a drag (CF-011 step 4)", () => {
    const { h, bd, second, placementIds } = cf010();
    dragAcross(h, bd, second);
    h.editing.beginDrag(placementIds[0][1], "body", 2.5 * BAR);
    expect(h.editing.getSelection()).toHaveLength(2);
    h.editing.endDrag();
    expect(h.editing.getSelection()).toEqual([placementIds[0][1]]);
  });

  it("marks arrangement_selection first used once, and selects the same with analytics off", () => {
    const on = cf010();
    dragAcross(on.h, on.bd, on.second);
    dragAcross(on.h, on.bd, on.second);
    const uses = eventsNamed(on.h.transport, "feature_first_use").map(
      (event) => event.params.feature,
    );
    expect(uses).toEqual(["arrangement_selection"]);

    const off = cf010({ analyticsAllowed: false });
    dragAcross(off.h, off.bd, off.second);
    expect(off.h.transport.events).toEqual([]);
    expect(off.h.editing.getSelection()).toEqual(on.h.editing.getSelection());
  });
});
