import { describe, expect, it } from "vitest";
import type { PlacementId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { buildArrangementProject } from "../testing/arrangementProject";
import { clipListEntries, revealScroll, stepClip } from "./clipListModel";
import type { RowMetrics } from "./geometry";
import { buildArrangementProjection } from "./projection";

const BAR = TICKS_PER_BAR;
const ROW_METRICS: RowMetrics = { trackHeightPx: 84, headerHeightPx: 84 };

describe("the clip list's entries (#76)", () => {
  it("lists every clip track by track, left to right, named with its track and bars", () => {
    // Laid out in reverse on the first track, so song order is not reading order.
    const { project, placementIds } = buildArrangementProject([
      [
        { startTicks: 2 * BAR, durationTicks: BAR },
        { startTicks: 0, durationTicks: 2 * BAR },
      ],
      [{ startTicks: BAR, durationTicks: BAR }],
    ]);
    const [[late, early], [second]] = placementIds;
    const [first, other] = project.song.tracks;
    const entries = clipListEntries(buildArrangementProjection(project, ROW_METRICS));

    expect(entries.map((entry) => entry.id)).toEqual([early, late, second]);
    const clipName = (id: PlacementId | undefined) => {
      const placement = project.song.placements.find((p) => p.id === id);
      return project.clips.find((clip) => clip.id === placement?.clipId)?.name;
    };
    expect(entries[0]?.label).toBe(`${clipName(early)} on ${first?.name}, bars 1 to 2`);
    expect(entries[2]?.label).toBe(`${clipName(second)} on ${other?.name}, bar 2`);
  });

  it("is empty for an arrangement with no clips", () => {
    const { project } = buildArrangementProject([[]]);
    expect(clipListEntries(buildArrangementProjection(project, ROW_METRICS))).toEqual([]);
  });
});

describe("stepping through the clip list (#76)", () => {
  const order = ["plc_a", "plc_b", "plc_c"] as PlacementId[];

  it("moves one clip either way", () => {
    expect(stepClip(order, order[1] ?? null, 1)).toBe("plc_c");
    expect(stepClip(order, order[1] ?? null, -1)).toBe("plc_a");
  });

  it("starts at the first going down and the last going up", () => {
    expect(stepClip(order, null, 1)).toBe("plc_a");
    expect(stepClip(order, null, -1)).toBe("plc_c");
    expect(stepClip(order, "plc_gone" as PlacementId, 1)).toBe("plc_a");
  });

  it("stays at either end rather than wrapping", () => {
    expect(stepClip(order, "plc_c" as PlacementId, 1)).toBe("plc_c");
    expect(stepClip(order, "plc_a" as PlacementId, -1)).toBe("plc_a");
  });

  it("has nowhere to go in an empty list", () => {
    expect(stepClip([], null, 1)).toBeNull();
  });
});

describe("revealing a clip (#76)", () => {
  const view = { scrollLeft: 100, scrollTop: 0, width: 400, height: 200 };

  it("leaves a clip already in view where it is", () => {
    expect(revealScroll(view, { left: 150, right: 300, top: 10, bottom: 50 })).toEqual({
      scrollLeft: 100,
      scrollTop: 0,
    });
  });

  it("scrolls as little as it can to a clip off either edge", () => {
    expect(revealScroll(view, { left: 40, right: 80, top: 0, bottom: 40 })).toEqual({
      scrollLeft: 40,
      scrollTop: 0,
    });
    expect(revealScroll(view, { left: 600, right: 700, top: 300, bottom: 340 })).toEqual({
      scrollLeft: 300,
      scrollTop: 140,
    });
  });

  it("aligns a clip wider than the view by its start", () => {
    expect(revealScroll(view, { left: 900, right: 2000, top: 0, bottom: 40 })).toEqual({
      scrollLeft: 900,
      scrollTop: 0,
    });
  });
});
