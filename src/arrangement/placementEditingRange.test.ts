import { describe, expect, it } from "vitest";
import { TICKS_PER_BAR } from "../domain/time";
import { pointSelection, rangeSelection } from "../selection";
import { buildArrangementProject } from "../testing/arrangementProject";
import { createEditingHarness } from "./placementEditingHarness";

const BAR = TICKS_PER_BAR;

/**
 * The controller holding the arrangement's one selection (#292), over CF-010's
 * layout: BD has clips in bars 1 and 3, the second track one across bars 1-3.
 */
function withRange(fromTicks = 1164, toTicks = 2700) {
  const built = buildArrangementProject([
    [
      { startTicks: 0, durationTicks: BAR },
      { startTicks: 2 * BAR, durationTicks: BAR },
    ],
    [{ startTicks: 0, durationTicks: 3 * BAR }],
  ]);
  const h = createEditingHarness({ project: built.project });
  const [bd, second] = built.trackIds;
  h.editing.setSelection(
    rangeSelection(
      built.project,
      { trackId: bd, ticks: fromTicks },
      { trackId: second, ticks: toTicks },
    ),
  );
  return { h, ...built };
}

/** Each placement as `[start, duration]`, in song order. */
const spans = (h: ReturnType<typeof createEditingHarness>) =>
  h.getProject().song.placements.map((p) => [p.startTicks, p.durationTicks]);

describe("one arrangement selection (#292)", () => {
  it("covers the clips a range touches, and reports its span for zooming", () => {
    const { h, placementIds, trackIds } = withRange();
    expect(h.editing.getSelection()).toEqual([placementIds[0][1], placementIds[1][0]]);
    expect(h.editing.hasSelection()).toBe(true);
    expect(h.editing.selectionSpan()).toEqual({
      trackIds: [...trackIds],
      startTicks: 1164,
      endTicks: 2700,
    });
  });

  it("gives a point no clips to act on, so the arrangement's edit shortcuts stay off", () => {
    const { h, trackIds } = withRange();
    h.editing.setSelection(pointSelection({ trackId: trackIds[0], ticks: 1548 }));
    expect(h.editing.getSelection()).toEqual([]);
    expect(h.editing.hasSelection()).toBe(false);
    expect(h.editing.deleteSelection()).toBe(false);
  });

  it("replaces a range with the clip a click selects, and a clip with a range", () => {
    const { h, placementIds, project, trackIds } = withRange();
    h.editing.select(placementIds[0][0]);
    expect(h.editing.getArrangementSelection()?.kind).toBe("clips");
    expect(h.editing.getSelection()).toEqual([placementIds[0][0]]);
    h.editing.setSelection(
      rangeSelection(
        project,
        { trackId: trackIds[0], ticks: 4 * BAR },
        {
          trackId: trackIds[0],
          ticks: 5 * BAR,
        },
      ),
    );
    expect(h.editing.getSelection()).toEqual([]);
  });

  it("deletes a range's time: a clip inside goes, one partly inside is trimmed (CF-010)", () => {
    const { h, placementIds } = withRange();
    expect(h.editing.deleteSelection()).toBe(true);
    expect(h.getProject().song.placements.map((p) => p.id)).toEqual([
      placementIds[0][0],
      placementIds[1][0],
    ]);
    expect(spans(h)).toEqual([
      [0, BAR],
      [0, 1164],
    ]);
    // The range stays selected, now covering nothing.
    expect(h.editing.getArrangementSelection()?.kind).toBe("range");
    expect(h.editing.hasSelection()).toBe(false);
  });

  it("cuts a range's time onto the clipboard as the covered pieces", () => {
    const { h } = withRange(BAR / 2, 2 * BAR + BAR / 2);
    expect(h.editing.cut()).toBe(true);
    expect(
      h.editing.getClipboard().map((entry) => [entry.startTicks, entry.durationTicks]),
    ).toEqual([
      [BAR / 2, BAR / 2],
      [2 * BAR, BAR / 2],
      [BAR / 2, 2 * BAR],
    ]);
    expect(spans(h)).toEqual([
      [0, BAR / 2],
      [2 * BAR + BAR / 2, BAR / 2],
      [0, BAR / 2],
      [2 * BAR + BAR / 2, BAR / 2],
    ]);
  });

  it("copies a range's covered pieces without changing the project", () => {
    const { h } = withRange();
    const before = h.getProject();
    expect(h.editing.copy()).toBe(true);
    expect(h.editing.getClipboard()).toHaveLength(2);
    expect(h.getProject()).toBe(before);
  });

  it("selects what a duplicate made, as clips", () => {
    const { h, placementIds } = withRange();
    h.editing.select(placementIds[0][0]);
    expect(h.editing.duplicate("linked")).toBe(true);
    const created = h.editing.getSelection();
    expect(created).toHaveLength(1);
    expect(created[0]).not.toBe(placementIds[0][0]);
  });
});
