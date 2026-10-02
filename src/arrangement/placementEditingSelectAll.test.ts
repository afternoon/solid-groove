import { describe, expect, it } from "vitest";
import { TICKS_PER_BAR } from "../domain/time";
import { pointSelection } from "../selection";
import { buildArrangementProject } from "../testing/arrangementProject";
import { createEditingHarness } from "./placementEditingHarness";
import { describeArrangementSelection } from "./selectionAnnouncement";

const BAR = TICKS_PER_BAR;

/** CF-029's layout: BD has clips in bars 1 to 3, the second track in bars 1 and 2. */
function cf029() {
  const bars = (count: number) =>
    Array.from({ length: count }, (_, bar) => ({
      startTicks: bar * BAR,
      durationTicks: BAR,
    }));
  const built = buildArrangementProject([bars(3), bars(2)]);
  const h = createEditingHarness({ project: built.project });
  const all = built.placementIds.flat();
  const says = () =>
    describeArrangementSelection(h.editing.getArrangementSelection(), h.getProject());
  return { h, all, says, ...built };
}

describe("Select all in the arrangement (#835)", () => {
  it("selects every clip on every track, from one clip selected (CF-029 step 3)", () => {
    const { h, all, placementIds, says } = cf029();
    h.editing.select(placementIds[0][0]);
    h.editing.selectAll();
    expect([...h.editing.getSelection()].sort()).toEqual([...all].sort());
    expect(says()).toBe("5 clips selected");
  });

  it("selects every clip from nothing selected, and from a point", () => {
    const { h, all, trackIds } = cf029();
    h.editing.selectAll();
    expect(h.editing.getSelection()).toHaveLength(all.length);
    h.editing.setSelection(pointSelection({ trackId: trackIds[1], ticks: 4 * BAR }));
    h.editing.selectAll();
    expect(h.editing.getSelection()).toHaveLength(all.length);
  });

  it("leaves the selection empty in a song with no clips", () => {
    const { h, trackIds } = cf029();
    h.editing.selectAll();
    expect(h.editing.deleteSelection()).toBe(true);
    h.editing.setSelection(pointSelection({ trackId: trackIds[0], ticks: 0 }));
    h.editing.selectAll();
    expect(h.editing.getArrangementSelection()).toBeNull();
    expect(describeArrangementSelection(null, h.getProject())).toBe("No selection");
  });

  it("is one ordinary selection: Delete removes every clip, and the tracks stay", () => {
    const { h, trackIds } = cf029();
    h.editing.selectAll();
    expect(h.editing.deleteSelection()).toBe(true);
    expect(h.getProject().song.placements).toEqual([]);
    expect(h.getProject().song.tracks.map((t) => t.id)).toEqual(trackIds);
  });

  it("copies, cuts and duplicates the full selection it made", () => {
    const copied = cf029();
    copied.h.editing.selectAll();
    expect(copied.h.editing.copy()).toBe(true);
    expect(copied.h.editing.getClipboard()).toHaveLength(5);

    const cut = cf029();
    cut.h.editing.selectAll();
    expect(cut.h.editing.cut()).toBe(true);
    expect(cut.h.getProject().song.placements).toEqual([]);
    expect(cut.h.editing.getClipboard()).toHaveLength(5);

    const duplicated = cf029();
    duplicated.h.editing.selectAll();
    expect(duplicated.h.editing.duplicate("independent")).toBe(true);
    // Each copy lands just after its source and wins the ticks it lands on
    // (#290), so the copies are what is selected afterwards: one per source.
    const copies = duplicated.h.editing.getSelection();
    expect(copies).toHaveLength(5);
    for (const source of duplicated.all) expect(copies).not.toContain(source);
  });
});
