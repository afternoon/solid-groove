import { describe, expect, it } from "vitest";
import { TICKS_PER_BAR } from "../domain/time";
import { pointSelection, rangeSelection } from "../selection";
import { buildArrangementProject } from "../testing/arrangementProject";
import { createEditingHarness } from "./placementEditingHarness";

const BAR = TICKS_PER_BAR;

/** BD has one clip across bar 1 and another in bar 3. */
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
 * Paste lands at the selection's start, Ableton-style (#292): the insertion
 * point, or the start of the selected range or clips, and only falls back to
 * the caller's anchor (the playhead) when nothing is selected.
 */
describe("paste at the selection start (#292)", () => {
  it("pastes at an insertion point exactly, not snapped to a bar", () => {
    const { h, bd, ids } = twoClips();
    h.editing.select(ids[0]);
    h.editing.copy();
    h.editing.setSelection(pointSelection({ trackId: bd, ticks: 4 * BAR + 192 }));

    expect(h.editing.paste(0)).toBe(true);
    expect(spans(h)).toEqual([
      [0, BAR],
      [2 * BAR, BAR],
      [4 * BAR + 192, BAR],
    ]);
  });

  it("puts a cut clip back where it was, because the cut time stays selected", () => {
    const { h, ids } = twoClips();
    const before = spans(h);
    h.editing.select(ids[1]);
    expect(h.editing.cut()).toBe(true);
    expect(spans(h)).toEqual([[0, BAR]]);
    expect(h.editing.getArrangementSelection()?.kind).toBe("range");
    expect(h.editing.hasSelection()).toBe(false);

    // The playhead anchor is ignored: the selection says where.
    expect(h.editing.paste(7 * BAR)).toBe(true);
    expect(spans(h)).toEqual(before);
  });

  it("keeps a copied range's leading gap, so the clip keeps its place in it", () => {
    const { h, bd } = twoClips();
    const project = h.getProject();
    h.editing.setSelection(
      rangeSelection(
        project,
        { trackId: bd, ticks: BAR },
        { trackId: bd, ticks: 3 * BAR },
      ),
    );
    h.editing.copy();
    h.editing.setSelection(pointSelection({ trackId: bd, ticks: 4 * BAR }));

    expect(h.editing.paste(0)).toBe(true);
    // The range began a bar before the clip, so the copy lands a bar after
    // the insertion point.
    expect(spans(h)).toContainEqual([5 * BAR, BAR]);
    expect(spans(h)).not.toContainEqual([4 * BAR, BAR]);
  });

  it("overwrites what it lands on, as a drop does (#290)", () => {
    const { h, bd, ids } = twoClips();
    h.editing.select(ids[1]);
    h.editing.copy();
    h.editing.setSelection(pointSelection({ trackId: bd, ticks: BAR / 2 }));

    expect(h.editing.paste(0)).toBe(true);
    expect(spans(h)).toEqual([
      [0, BAR / 2],
      [BAR / 2, BAR],
      [2 * BAR, BAR],
    ]);
  });

  it("selects what it pasted", () => {
    const { h, bd, ids } = twoClips();
    h.editing.select(ids[0]);
    h.editing.copy();
    h.editing.setSelection(pointSelection({ trackId: bd, ticks: 6 * BAR }));
    h.editing.paste(0);

    const [pasted] = h.editing.getSelection();
    const placement = h.getProject().song.placements.find((p) => p.id === pasted);
    expect(placement?.startTicks).toBe(6 * BAR);
  });

  it("does nothing with an empty clipboard, whatever is selected", () => {
    const { h, bd } = twoClips();
    h.editing.setSelection(pointSelection({ trackId: bd, ticks: 4 * BAR }));
    const before = h.getProject();
    expect(h.editing.paste(0)).toBe(false);
    expect(h.getProject()).toBe(before);
  });
});
