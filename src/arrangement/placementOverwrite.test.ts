/**
 * Overwrite resolution for placement edits (#290, option B).
 *
 * A track's placements are disjoint, and the product owner chose how an edit
 * that lands on occupied ticks resolves: the incoming placement wins, and
 * whatever it covers is removed (full cover), trimmed to the boundary (partial
 * cover) or split around it (landing inside). A drag resolves once, on release —
 * dragging past a neighbour leaves it intact.
 *
 * These drive the real controller against a real `CommandHistory`, so each
 * gesture is the one-entry, one-revision transaction the editor commits.
 */

import { describe, expect, it } from "vitest";
import { addPlacement, updatePlacement } from "../commands/definitions/placements";
import { CommandHistory } from "../commands/history";
import type { Placement } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { TICKS_PER_BAR, toTicks } from "../domain/time";
import { createPlacementAt } from "./placementClipboard";
import { createPlacementEditing } from "./placementEditingController";
import { resizePlacement } from "./placementGeometry";

const BAR = TICKS_PER_BAR;

function setup() {
  const history = new CommandHistory(createSliceFixtureProject());
  const ids = createSeededIdFactory("overwrite");
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
  });
  const source = history.project.song.placements[0];
  /** Adds a placement of the fixture's clip at `[start, start + duration)`. */
  const place = (startBars: number, durationBars: number): Placement => {
    const placement: Placement = {
      ...source,
      id: ids("placement"),
      startTicks: toTicks(startBars * BAR),
      durationTicks: toTicks(durationBars * BAR),
    };
    const result = history.execute(addPlacement(placement));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    return placement;
  };
  const spans = () =>
    history.project.song.placements
      .map((p) => [p.startTicks / BAR, p.durationTicks / BAR, p.clipOffsetTicks / BAR])
      .sort((a, b) => a[0] - b[0]);
  return { history, editing, ids, source, place, spans };
}

describe("drag overwrites on release (#290)", () => {
  it("leaves a neighbour intact mid-drag and removes it once the drop covers it", () => {
    const { history, editing, source, place, spans } = setup();
    const neighbour = place(2, 1);

    editing.beginDrag(source.id, "body", 0);
    editing.updateDrag(2 * BAR);
    // Mid-drag the dragged placement sits over the neighbour, which survives.
    expect(spans()).toEqual([
      [2, 1, 0],
      [2, 1, 0],
    ]);
    editing.updateDrag(4 * BAR);
    editing.updateDrag(2 * BAR);
    editing.endDrag();

    expect(history.project.song.placements.map((p) => p.id)).toEqual([source.id]);
    expect(spans()).toEqual([[2, 1, 0]]);

    // One entry: a single undo puts both back where they were.
    history.undo();
    expect(history.project.song.placements.map((p) => p.id)).toEqual([
      source.id,
      neighbour.id,
    ]);
    expect(spans()).toEqual([
      [0, 1, 0],
      [2, 1, 0],
    ]);
  });

  it("dragging past a neighbour and dropping clear of it leaves it untouched", () => {
    const { editing, source, place, spans } = setup();
    place(2, 1);
    editing.beginDrag(source.id, "body", 0);
    editing.updateDrag(2 * BAR);
    editing.updateDrag(5 * BAR);
    editing.endDrag();
    expect(spans()).toEqual([
      [2, 1, 0],
      [5, 1, 0],
    ]);
  });

  it("a resize that grows over a neighbour trims it to the new edge", () => {
    const { editing, source, place, spans } = setup();
    place(1, 2);
    editing.beginDrag(source.id, "end", BAR);
    editing.updateDrag(2 * BAR);
    editing.endDrag();
    expect(spans()).toEqual([
      [0, 2, 0],
      [2, 1, 1],
    ]);
  });
});

describe("a gesture never commits an overlap (#290)", () => {
  it("abandons a gesture that ends with placements still overlapping", () => {
    const { history, source, place, spans } = setup();
    place(2, 1);
    const gesture = history.beginGesture();
    expect(
      gesture.apply(updatePlacement(source.id, { startTicks: toTicks(2 * BAR) })).ok,
    ).toBe(true);
    expect(gesture.commit()).toBeNull();
    expect(spans()).toEqual([
      [0, 1, 0],
      [2, 1, 0],
    ]);
    expect(history.entries).toHaveLength(1);
  });
});

describe("duplicate and add overwrite what they land on (#290)", () => {
  it("duplicating onto a longer neighbour trims its head", () => {
    const { editing, source, place, spans } = setup();
    place(1, 2);
    editing.select(source.id);
    expect(editing.duplicate("linked")).toBe(true);
    expect(spans()).toEqual([
      [0, 1, 0],
      [1, 1, 0],
      [2, 1, 1],
    ]);
  });

  it("adding a placement inside a longer one splits it around the new one", () => {
    const { history, ids, source, spans } = setup();
    history.execute(resizePlacement(history.project, source.id, "end", 4 * BAR));
    const { commands } = createPlacementAt(history.project, source.clipId, BAR, ids);
    expect(history.execute(commands).ok).toBe(true);
    expect(spans()).toEqual([
      [0, 1, 0],
      [1, 1, 0],
      [2, 2, 2],
    ]);

    history.undo();
    expect(spans()).toEqual([[0, 4, 0]]);
  });
});
