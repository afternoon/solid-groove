/** Right-edge repeat (#493): past the end it tiles linked copies; inward it trims. */

import { describe, expect, it } from "vitest";
import { updatePlacement } from "../commands/definitions/placements";
import { CommandHistory } from "../commands/history";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory, type PlacementId } from "../domain/ids";
import { TICKS_PER_BAR, toTicks } from "../domain/time";
import { createPlacementEditing } from "./placementEditingController";
import { createEditingHarness, eventsNamed } from "./placementEditingHarness";
import { tilePlacements } from "./placementTile";

const BAR = TICKS_PER_BAR;

function setup() {
  const history = new CommandHistory(createSliceFixtureProject());
  const ids = createSeededIdFactory("tile");
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
  /** `[start, duration]` in bars, in start order. */
  const spans = () =>
    [...history.project.song.placements]
      .sort((a, b) => a.startTicks - b.startTicks)
      .map((p) => [p.startTicks / BAR, p.durationTicks / BAR]);
  return { history, editing, source, spans };
}

describe("tilePlacements", () => {
  const { source } = setup();
  const id = (k: number) => `plc_${k}` as PlacementId;

  it("tiles whole repeats up to the target", () => {
    const copies = tilePlacements(source, 3 * BAR, id);
    expect(copies.map((c) => [c.startTicks / BAR, c.durationTicks / BAR])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(copies.every((c) => c.clipId === source.clipId)).toBe(true);
    expect(copies.map((c) => c.id)).toEqual([id(0), id(1)]);
  });

  it("trims the last copy so the tiling ends on the target's bar line", () => {
    const long = { ...source, durationTicks: toTicks(2 * BAR) };
    const copies = tilePlacements(long, 5 * BAR, id);
    expect(copies.map((c) => [c.startTicks / BAR, c.durationTicks / BAR])).toEqual([
      [2, 2],
      [4, 1],
    ]);
  });

  it("tiles nothing at or before the source's end", () => {
    expect(tilePlacements(source, source.startTicks + source.durationTicks, id)).toEqual(
      [],
    );
  });
});

describe("dragging the right edge", () => {
  it("past the end tiles linked copies as one entry and leaves the source alone", () => {
    const { history, editing, source, spans } = setup();
    const entries = history.entries.length;
    const revision = history.project.metadata.revision;
    editing.beginDrag(source.id, "end", BAR);
    editing.updateDrag(2 * BAR);
    editing.updateDrag(4 * BAR);
    editing.endDrag();

    expect(spans()).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    const { clips, song } = history.project;
    expect(song.placements.every((p) => p.clipId === source.clipId)).toBe(true);
    expect(clips.filter((c) => c.id === source.clipId)).toHaveLength(1);
    expect(history.entries).toHaveLength(entries + 1);
    expect(history.project.metadata.revision).toBe(revision + 1);

    history.undo();
    expect(spans()).toEqual([[0, 1]]);
  });

  it("dragged back inside the span drops the copies it no longer reaches", () => {
    const { editing, source, spans } = setup();
    editing.beginDrag(source.id, "end", BAR);
    editing.updateDrag(4 * BAR);
    editing.updateDrag(2 * BAR);
    editing.endDrag();
    expect(spans()).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it("dragged back to the clip's own end changes nothing and adds no entry", () => {
    const { history, editing, source } = setup();
    const before = history.project;
    editing.beginDrag(source.id, "end", BAR);
    editing.updateDrag(4 * BAR);
    editing.updateDrag(BAR);
    editing.endDrag();
    expect(history.project).toBe(before);
  });

  it("a longer clip trims when dragged inward, and never lengthens", () => {
    const { history, editing, source, spans } = setup();
    history.execute(updatePlacement(source.id, { durationTicks: toTicks(4 * BAR) }));
    editing.beginDrag(source.id, "end", 4 * BAR);
    editing.updateDrag(2 * BAR);
    editing.endDrag();
    expect(spans()).toEqual([[0, 2]]);
  });

  it("Escape mid-drag puts the project back", () => {
    const { history, editing, source } = setup();
    const before = history.project;
    editing.beginDrag(source.id, "end", BAR);
    editing.updateDrag(4 * BAR);
    editing.cancelDrag();
    expect(history.project).toBe(before);
  });

  it("logs one linked placement_duplicated per drag, with no names", () => {
    const h = createEditingHarness();
    h.editing.beginDrag(h.placementId(), "end", BAR);
    h.editing.updateDrag(3 * BAR);
    h.editing.updateDrag(4 * BAR);
    h.editing.endDrag();
    expect(eventsNamed(h.transport, "placement_duplicated")).toMatchObject([
      { params: { mode: "linked" } },
    ]);
  });

  it("logs nothing when analytics are off", () => {
    const h = createEditingHarness({ analyticsAllowed: false });
    h.editing.beginDrag(h.placementId(), "end", BAR);
    h.editing.updateDrag(4 * BAR);
    h.editing.endDrag();
    expect(eventsNamed(h.transport, "placement_duplicated")).toEqual([]);
    expect(h.getProject().song.placements).toHaveLength(4);
  });
});
