import { describe, expect, it } from "vitest";
import { TICKS_PER_BAR } from "../domain/time";
import { pointSelection } from "../selection";
import { buildArrangementProject } from "../testing/arrangementProject";
import { createEditingHarness } from "./placementEditingHarness";

const BAR = TICKS_PER_BAR;

/** BD has one clip in bar 1 and another in bar 3. */
function twoClips() {
  const built = buildArrangementProject([
    [
      { startTicks: 0, durationTicks: BAR },
      { startTicks: 2 * BAR, durationTicks: BAR },
    ],
  ]);
  const h = createEditingHarness({ project: built.project });
  return { h, bd: built.trackIds[0], ids: built.placementIds[0] };
}

/** Each placement as `[start, duration]`, in start order. */
const spans = (h: ReturnType<typeof createEditingHarness>) =>
  h
    .getProject()
    .song.placements.map((p) => [p.startTicks, p.durationTicks])
    .sort((a, b) => a[0] - b[0]);

/**
 * Paste lands at the selection's start, Ableton-style (#292): the point, or
 * the earliest selected clip's start, and only falls back to the caller's
 * anchor (the playhead) when nothing is selected.
 */
describe("paste at the selection start (#292)", () => {
  it("pastes at the point a click set, on its bar line", () => {
    const { h, bd, ids } = twoClips();
    h.editing.select(ids[0]);
    h.editing.copy();
    h.editing.placePoint({ trackId: bd, ticks: 4.5 * BAR });

    // The playhead anchor is ignored: the selection says where.
    expect(h.editing.paste(7 * BAR)).toBe(true);
    expect(spans(h)).toEqual([
      [0, BAR],
      [2 * BAR, BAR],
      [4 * BAR, BAR],
    ]);
  });

  it("pastes at an exact point unsnapped", () => {
    const { h, bd, ids } = twoClips();
    h.editing.select(ids[0]);
    h.editing.copy();
    h.editing.setSelection(pointSelection({ trackId: bd, ticks: 4 * BAR + 192 }));
    expect(h.editing.paste(0)).toBe(true);
    expect(spans(h)).toContainEqual([4 * BAR + 192, BAR]);
  });

  it("puts a cut clip back where it was, because the cut leaves a point there", () => {
    const { h, bd, ids } = twoClips();
    const before = spans(h);
    h.editing.select(ids[1]);
    expect(h.editing.cut()).toBe(true);
    expect(spans(h)).toEqual([[0, BAR]]);
    expect(h.editing.getArrangementSelection()).toEqual(
      pointSelection({ trackId: bd, ticks: 2 * BAR }),
    );
    expect(h.editing.paste(7 * BAR)).toBe(true);
    expect(spans(h)).toEqual(before);
  });

  it("pastes over the selected clips, at the earliest one's start", () => {
    const { h, ids } = twoClips();
    h.editing.select(ids[0]);
    h.editing.copy();
    h.editing.select(ids[1]);
    expect(h.editing.paste(7 * BAR)).toBe(true);
    // The copy replaced the bar-3 clip it landed on (#290 overwrite).
    expect(spans(h)).toEqual([
      [0, BAR],
      [2 * BAR, BAR],
    ]);
    expect(h.getProject().song.placements.map((p) => p.id)).not.toContain(ids[1]);
  });

  it("selects what it pasted", () => {
    const { h, bd, ids } = twoClips();
    h.editing.select(ids[0]);
    h.editing.copy();
    h.editing.placePoint({ trackId: bd, ticks: 6 * BAR });
    h.editing.paste(0);
    const [pasted] = h.editing.getSelection();
    const placement = h.getProject().song.placements.find((p) => p.id === pasted);
    expect(placement?.startTicks).toBe(6 * BAR);
  });

  it("does nothing with an empty clipboard, whatever is selected", () => {
    const { h, bd } = twoClips();
    h.editing.placePoint({ trackId: bd, ticks: 4 * BAR });
    const before = h.getProject();
    expect(h.editing.paste(0)).toBe(false);
    expect(h.getProject()).toBe(before);
  });
});
