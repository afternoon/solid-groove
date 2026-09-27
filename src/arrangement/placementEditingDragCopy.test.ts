/**
 * Alt-drag copy (ARR-011) through the real controller and a real
 * `CommandHistory`, so each drop is the one-entry, one-revision gesture the
 * editor commits, and a mode switch mid-drag really reverts what it showed.
 *
 * The controller is told whether Alt is held at each step and at the drop;
 * reading the modifier off the pointer event is `ArrangementView`'s job.
 */

import { describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { removeNotes } from "../commands/definitions/notes";
import { addPlacement } from "../commands/definitions/placements";
import { addTrack } from "../commands/definitions/tracks";
import { CommandHistory } from "../commands/history";
import type { Placement } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { TICKS_PER_BAR, toTicks } from "../domain/time";
import { memoryStorage } from "../testing/storage";
import { copyClip } from "./placementDuplication";
import { createPlacementEditing } from "./placementEditingController";

const BAR = TICKS_PER_BAR;

/** Two tracks, one clip each in bar 1: CF-016's starting point. */
function setup(options: { analyticsAllowed?: boolean } = {}) {
  const ids = createSeededIdFactory("drag-copy");
  const history = new CommandHistory(createSliceFixtureProject());
  const [track] = history.project.song.tracks;
  const [first] = history.project.song.placements;
  const clip = copyClip(history.project.clips[0], ids);
  const second = { ...track, id: ids("track"), name: "Sampler", order: 1 };
  const secondClip = { ...clip, trackId: second.id };
  const placed: Placement = {
    ...first,
    id: ids("placement"),
    trackId: second.id,
    clipId: secondClip.id,
  };
  const added = history.execute(
    addTrack(second, { clips: [secondClip], placements: [placed] }),
  );
  if (!added.ok) throw new Error(JSON.stringify(added.issues));
  history.clear();

  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  const allowed = options.analyticsAllowed ?? true;
  consent.set({ productAnalytics: allowed, errorMonitoring: allowed });
  const analytics = new Analytics({ transport, consent, storage: memoryStorage() });

  const editing = createPlacementEditing({
    getProject: () => history.project,
    dispatch: (commands) => {
      history.execute(commands);
    },
    beginGesture: (summary) => {
      const gesture = history.beginGesture({ summary });
      return {
        apply: (commands) => {
          gesture.apply(commands);
        },
        commit: (text) => {
          gesture.commit(text);
        },
        cancel: () => gesture.cancel(),
      };
    },
    ids,
    analytics,
  });
  editing.setSelection({ kind: "clips", placementIds: [first.id, placed.id] });

  /** Bars (1-based) holding a clip, per track in order: `"1,3|1"`. */
  const bars = () =>
    history.project.song.tracks
      .map((t) =>
        history.project.song.placements
          .filter((p) => p.trackId === t.id)
          .map((p) => p.startTicks / BAR + 1)
          .sort()
          .join(","),
      )
      .join("|");
  const events = (name: string) => transport.events.filter((e) => e.name === name);
  return { history, editing, ids, first, second: placed, bars, events };
}

type Harness = ReturnType<typeof setup>;

/**
 * Press on `id` in bar `from`, move through `steps` — bars, `a` marking Alt
 * held, e.g. `"2 3a"` — and drop, with Alt held there when `altAtDrop`.
 */
function drag(h: Harness, steps: string, altAtDrop: boolean, id = h.first.id, from = 1) {
  h.editing.beginDrag(id, "body", (from - 1) * BAR + BAR / 2);
  for (const step of steps.split(" ").filter(Boolean)) {
    h.editing.updateDrag(
      (Number.parseInt(step, 10) - 1) * BAR + BAR / 2,
      step.endsWith("a"),
    );
  }
  h.editing.endDrag(altAtDrop);
}

describe("Alt-drag copies the selection (ARR-011)", () => {
  it("copies every selected clip by the offset, each on its own track", () => {
    const h = setup();
    const revision = h.history.project.metadata.revision;
    drag(h, "2a 3a", true);
    expect(h.bars()).toBe("1,3|1,3");
    expect(h.history.project.metadata.revision).toBe(revision + 1);
    // The copies are the selection, so a second Alt-drag copies them.
    const copies = h.editing.getSelection();
    expect(copies).toHaveLength(2);
    expect(copies).not.toContain(h.first.id);
    const pressed = h.history.project.song.placements.find(
      (p) => copies.includes(p.id) && p.trackId === h.first.trackId,
    );
    drag(h, "5a", true, pressed?.id, 3);
    expect(h.bars()).toBe("1,3,5|1,3,5");
  });

  it("is one undo step that removes every copy", () => {
    const h = setup();
    const before = h.history.project;
    drag(h, "2a 3a 4a", true);
    h.history.undo();
    expect(h.history.project.song).toEqual(before.song);
    expect(h.history.project.clips).toEqual(before.clips);
  });

  it("makes independent clips: an edit to a copy is not in its original", () => {
    const h = setup();
    drag(h, "3a", true);
    const copy = h.history.project.song.placements.find(
      (p) => p.trackId === h.first.trackId && p.id !== h.first.id,
    );
    const source = h.history.project.clips.find((c) => c.id === h.first.clipId);
    const copied = h.history.project.clips.find((c) => c.id === copy?.clipId);
    if (copied?.content.kind !== "notes" || copied.id === source?.id) {
      throw new Error("expected an independent note clip");
    }
    h.history.execute(removeNotes(copied.id, [copied.content.events[0].id]));
    expect(h.history.project.clips.find((c) => c.id === h.first.clipId)).toEqual(source);
  });

  it("overwrites what a copy lands on, as a moved clip does (#290)", () => {
    const h = setup();
    const neighbour = {
      ...h.first,
      id: h.ids("placement"),
      startTicks: toTicks(2 * BAR),
    };
    h.history.execute(addPlacement(neighbour));
    h.editing.setSelection({ kind: "clips", placementIds: [h.first.id] });
    drag(h, "3a", true);
    expect(h.bars()).toBe("1,3|1");
    const ids = h.history.project.song.placements.map((p) => p.id);
    expect(ids).not.toContain(neighbour.id);
  });

  it("logs placement_duplicated and its first use once per drop; analytics off changes nothing", () => {
    const on = setup();
    drag(on, "3a", true);
    const logged = on.events("placement_duplicated").map((e) => e.params.mode);
    expect(logged).toEqual(["independent"]);
    const firstUse = on.events("feature_first_use").map((e) => e.params.feature);
    expect(firstUse.filter((f) => f === "arrangement_drag_copy")).toHaveLength(1);

    const off = setup({ analyticsAllowed: false });
    drag(off, "3a", true);
    expect(off.bars()).toBe(on.bars());
  });
});

describe("Alt changes the mode mid-drag", () => {
  it("letting go of Alt moves instead, and the preview follows", () => {
    const h = setup();
    h.editing.beginDrag(h.first.id, "body", BAR / 2);
    h.editing.updateDrag(2 * BAR + BAR / 2, true);
    // The preview shows copies; the originals stay put.
    expect(h.bars()).toBe("1,3|1,3");
    h.editing.updateDrag(2 * BAR + BAR / 2, false);
    // Alt up: the copies go, and the pressed clip moves.
    expect(h.bars()).toBe("3|1");
    h.editing.endDrag(false);
    expect(h.bars()).toBe("3|1");
    expect(h.history.project.clips).toHaveLength(2);
  });

  it("pressing Alt mid-drag, or only at the drop, copies", () => {
    const mid = setup();
    drag(mid, "2 3a", true);
    expect(mid.bars()).toBe("1,3|1,3");
    const atDrop = setup();
    drag(atDrop, "3", true);
    expect(atDrop.bars()).toBe("1,3|1,3");
  });

  it("a press and release with Alt but no move changes nothing", () => {
    const h = setup();
    const before = h.history.project;
    drag(h, "1a", true);
    expect(h.history.project).toBe(before);
    expect(h.events("placement_duplicated")).toEqual([]);
  });

  it("Alt-drag on an edge resizes, as a plain edge drag does", () => {
    const h = setup();
    h.editing.beginDrag(h.first.id, "end", h.first.durationTicks);
    h.editing.updateDrag(4 * BAR, true);
    h.editing.endDrag(true);
    const resized = h.history.project.song.placements.find((p) => p.id === h.first.id);
    expect(resized?.durationTicks).toBe(4 * BAR);
    expect(h.history.project.song.placements).toHaveLength(2);
  });
});

describe("Alt is read at the drop", () => {
  it("let go between the last step and the drop, the drag moves instead", () => {
    const h = setup();
    const revision = h.history.project.metadata.revision;
    drag(h, "2a 3a", false);
    expect(h.bars()).toBe("3|1");
    expect(h.history.project.clips).toHaveLength(2);
    expect(h.history.project.metadata.revision).toBe(revision + 1);
    expect(h.events("placement_duplicated")).toEqual([]);
  });

  it("the move it becomes overwrites what it lands on (#290)", () => {
    const h = setup();
    const neighbour = {
      ...h.first,
      id: h.ids("placement"),
      startTicks: toTicks(2 * BAR),
    };
    h.history.execute(addPlacement(neighbour));
    drag(h, "3a", false);
    expect(h.bars()).toBe("3|1");
  });
});

describe("Escape mid-drag", () => {
  it("leaves the project and the selection as they were", () => {
    const h = setup();
    const project = h.history.project;
    const selection = h.editing.getArrangementSelection();
    h.editing.beginDrag(h.first.id, "body", BAR / 2);
    h.editing.updateDrag(3 * BAR, true);
    h.editing.cancelDrag();
    expect(h.history.project).toBe(project);
    expect(h.editing.getArrangementSelection()).toBe(selection);
    expect(h.history.canUndo).toBe(false);
  });

  it("puts back the selection a press on an unselected clip replaced", () => {
    const h = setup();
    h.editing.setSelection({ kind: "clips", placementIds: [h.second.id] });
    const selection = h.editing.getArrangementSelection();
    h.editing.beginDrag(h.first.id, "body", BAR / 2);
    h.editing.updateDrag(3 * BAR, false);
    h.editing.cancelDrag();
    expect(h.editing.getArrangementSelection()).toBe(selection);
  });
});
