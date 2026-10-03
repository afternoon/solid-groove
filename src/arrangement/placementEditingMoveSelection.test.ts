/**
 * A plain drag on a selected clip moves the whole selection (#872), through
 * the real controller and a real `CommandHistory`, so the drop is one entry
 * and one revision, as the editor commits it.
 */

import { describe, expect, it } from "vitest";
import { addPlacement } from "../commands/definitions/placements";
import { addTrack } from "../commands/definitions/tracks";
import { CommandHistory } from "../commands/history";
import type { Placement } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { TICKS_PER_BAR, toTicks } from "../domain/time";
import { copyClip } from "./placementDuplication";
import { createPlacementEditing } from "./placementEditingController";

const BAR = TICKS_PER_BAR;

/** Two tracks, one clip each in bar 1, both selected. */
function setup(options: { gestures?: boolean } = {}) {
  const ids = createSeededIdFactory("move-selection");
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

  const editing = createPlacementEditing({
    getProject: () => history.project,
    dispatch: (commands) => {
      history.execute(commands);
    },
    beginGesture:
      options.gestures === false
        ? undefined
        : (summary) => {
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
  return { history, editing, ids, first, second: placed, bars };
}

type Harness = ReturnType<typeof setup>;

/** Press on `id` in bar `from`, move through the bars in `steps`, and drop. */
function drag(h: Harness, steps: number[], id = h.first.id, from = 1) {
  h.editing.beginDrag(id, "body", (from - 1) * BAR + BAR / 2);
  for (const bar of steps) h.editing.updateDrag((bar - 1) * BAR + BAR / 2);
  h.editing.endDrag();
}

describe("dragging a selected clip moves every selected clip (#872)", () => {
  it("moves the whole selection by the drag's offset, as one undo step", () => {
    const h = setup();
    const revision = h.history.project.metadata.revision;
    drag(h, [2, 3]);
    expect(h.bars()).toBe("3|3");
    expect(h.history.project.metadata.revision).toBe(revision + 1);
    expect(h.editing.getSelection()).toEqual([h.first.id, h.second.id]);
    h.history.undo();
    expect(h.bars()).toBe("1|1");
  });

  it("previews the whole selection moving while the pointer is down", () => {
    const h = setup();
    h.editing.beginDrag(h.first.id, "body", BAR / 2);
    h.editing.updateDrag(2 * BAR + BAR / 2);
    expect(h.bars()).toBe("3|3");
    h.editing.updateDrag(BAR / 2);
    expect(h.bars()).toBe("1|1");
    h.editing.endDrag();
    expect(h.bars()).toBe("1|1");
  });

  it("dragging the other selected clip carries the first too", () => {
    const h = setup();
    drag(h, [4], h.second.id);
    expect(h.bars()).toBe("4|4");
  });

  it("keeps the clips' spacing, stopping where the earliest meets the song start", () => {
    const h = setup();
    const later = { ...h.first, id: h.ids("placement"), startTicks: toTicks(2 * BAR) };
    h.history.execute(addPlacement(later));
    h.editing.setSelection({ kind: "clips", placementIds: [h.first.id, later.id] });
    drag(h, [1], later.id, 3);
    expect(h.bars()).toBe("1,3|1");
  });

  it("overwrites what any moved clip lands on (#290)", () => {
    const h = setup();
    const neighbour = {
      ...h.first,
      id: h.ids("placement"),
      startTicks: toTicks(2 * BAR),
    };
    h.history.execute(
      addPlacement({ ...neighbour, trackId: h.second.trackId, clipId: h.second.clipId }),
    );
    drag(h, [3]);
    expect(h.bars()).toBe("3|3");
    const ids = h.history.project.song.placements.map((p) => p.id);
    expect(ids).not.toContain(neighbour.id);
  });

  it("pressing an unselected clip moves that clip alone", () => {
    const h = setup();
    h.editing.setSelection({ kind: "clips", placementIds: [h.second.id] });
    drag(h, [3]);
    expect(h.bars()).toBe("3|1");
  });

  it("moves the whole selection without gestures too", () => {
    const h = setup({ gestures: false });
    drag(h, [2, 3]);
    expect(h.bars()).toBe("3|3");
  });
});
