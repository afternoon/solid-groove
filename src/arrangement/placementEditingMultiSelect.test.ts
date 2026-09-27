import { describe, expect, it } from "vitest";
import { TICKS_PER_BAR } from "../domain/time";
import { pointSelection } from "../selection";
import { buildArrangementProject } from "../testing/arrangementProject";
import { createEditingHarness, eventsNamed } from "./placementEditingHarness";
import { describeArrangementSelection } from "./selectionAnnouncement";

const BAR = TICKS_PER_BAR;

/** CF-015's layout: BD and a second track each have a clip in bars 1, 2 and 3. */
function cf015(options: { analyticsAllowed?: boolean } = {}) {
  const row = [0, 1, 2].map((bar) => ({ startTicks: bar * BAR, durationTicks: BAR }));
  const built = buildArrangementProject([row, row]);
  const h = createEditingHarness({ ...options, project: built.project });
  const [bd, second] = built.placementIds;
  const says = () =>
    describeArrangementSelection(h.editing.getArrangementSelection(), h.getProject());
  return { h, bd, second, says, ...built };
}

/** CF-015 steps 2 to 5, through the controller. */
function walkCf015(fixture: ReturnType<typeof cf015>) {
  const { h, bd, second } = fixture;
  h.editing.select(bd[0]);
  h.editing.toggleClip(bd[2]);
  h.editing.toggleClip(bd[0]);
  h.editing.extendTo(second[1]);
}

describe("Cmd-click and Shift-click on clips (#405)", () => {
  it("toggles one clip in and out, keeping the rest (CF-015 steps 3-4)", () => {
    const { h, bd, says } = cf015();
    h.editing.select(bd[0]);
    h.editing.toggleClip(bd[2]);
    // Two, not three: the clip between them stays out.
    expect(h.editing.getSelection()).toEqual([bd[0], bd[2]]);
    expect(says()).toBe("2 clips selected");
    h.editing.toggleClip(bd[0]);
    expect(h.editing.getSelection()).toEqual([bd[2]]);
    expect(says()).toBe("Selected clip on BD, bar 3");
    h.editing.toggleClip(bd[2]);
    expect(h.editing.getArrangementSelection()).toBeNull();
  });

  it("extends to every clip in the box, across the tracks between (CF-015 step 5)", () => {
    const fixture = cf015();
    const { h, bd, second, says } = fixture;
    walkCf015(fixture);
    expect(h.editing.getSelection()).toEqual([bd[1], bd[2], second[1], second[2]]);
    expect(says()).toBe("4 clips selected");
    // It is one ordinary selection: Delete removes exactly those, whole.
    expect(h.editing.deleteSelection()).toBe(true);
    expect(h.getProject().song.placements.map((p) => p.id)).toEqual([bd[0], second[0]]);
  });

  it("treats Shift-click with no clip selected as a plain click", () => {
    const { h, bd, trackIds } = cf015();
    h.editing.extendTo(bd[1]);
    expect(h.editing.getSelection()).toEqual([bd[1]]);
    h.editing.setSelection(pointSelection({ trackId: trackIds[1], ticks: 0 }));
    h.editing.extendTo(bd[2]);
    expect(h.editing.getSelection()).toEqual([bd[2]]);
    expect(eventsNamed(h.transport, "feature_first_use")).toEqual([]);
  });

  it("marks each gesture first used once, with no names, and selects the same with analytics off", () => {
    const on = cf015();
    walkCf015(on);
    walkCf015(on);
    const uses = eventsNamed(on.h.transport, "feature_first_use");
    expect(uses.map((event) => event.params.feature)).toEqual([
      "arrangement_toggle_select",
      "arrangement_extend_select",
    ]);
    // Only the catalogued keys: no project, track or clip name rides along.
    for (const event of uses) {
      expect(Object.keys(event.params).sort()).toEqual([
        "feature",
        "release_sha",
        "surface",
      ]);
    }

    const off = cf015({ analyticsAllowed: false });
    walkCf015(off);
    expect(off.h.transport.events).toEqual([]);
    expect(off.h.editing.getSelection()).toEqual(on.h.editing.getSelection());
  });
});
