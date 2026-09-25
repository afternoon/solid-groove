import { beforeEach, describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { CommandHistory } from "../commands";
import { createSliceFixtureProject } from "../domain/fixtures";
import { TICKS_PER_BAR } from "../domain/time";
import { memoryStorage } from "../testing/storage";
import {
  createLoopBraceDrag,
  describeLoopBars,
  draggedLoopRange,
  hitTestLoopBrace,
  LOOP_HANDLE_HIT_PX,
} from "./loopBrace";

const BAR = TICKS_PER_BAR;
const bars = (first: number, last: number) => ({
  startTicks: (first - 1) * BAR,
  endTicks: last * BAR,
});

describe("describeLoopBars", () => {
  it("names the first and last bar, inclusive and 1-based", () => {
    expect(describeLoopBars({ startTicks: 0, endTicks: BAR })).toBe("bar 1");
    expect(describeLoopBars({ startTicks: 2 * BAR, endTicks: 3 * BAR })).toBe("bar 3");
    expect(describeLoopBars({ startTicks: 0, endTicks: 2 * BAR })).toBe("bars 1 to 2");
    expect(describeLoopBars({ startTicks: 4 * BAR, endTicks: 8 * BAR })).toBe(
      "bars 5 to 8",
    );
  });
});

describe("hitTestLoopBrace", () => {
  // 0.1 px per tick: bar 1 is 0-76.8 px, bar 2 ends at 153.6 px.
  const viewport = { pixelsPerTick: 0.1, scrollLeft: 0 };
  const range = bars(1, 2);

  it("grabs an edge within the hit slop, and the middle between them", () => {
    expect(hitTestLoopBrace(range, 153.6, viewport)).toBe("end");
    expect(hitTestLoopBrace(range, 153.6 + LOOP_HANDLE_HIT_PX, viewport)).toBe("end");
    expect(hitTestLoopBrace(range, 2, viewport)).toBe("start");
    expect(hitTestLoopBrace(range, 76.8, viewport)).toBe("body");
    expect(hitTestLoopBrace(range, 200, viewport)).toBeNull();
  });

  it("measures against the scrolled position the ruler is drawn at", () => {
    const scrolled = { pixelsPerTick: 0.1, scrollLeft: 100 };
    expect(hitTestLoopBrace(range, 53.6, scrolled)).toBe("end");
    expect(hitTestLoopBrace(range, 153.6, scrolled)).toBeNull();
  });
});

describe("draggedLoopRange", () => {
  it("snaps a dragged edge to the nearest bar line", () => {
    expect(draggedLoopRange(bars(1, 1), "end", BAR, 2 * BAR + 50)).toEqual(bars(1, 2));
    expect(draggedLoopRange(bars(1, 1), "end", BAR, 2 * BAR - 50)).toEqual(bars(1, 2));
    expect(draggedLoopRange(bars(3, 4), "start", 2 * BAR, BAR + 10)).toEqual(bars(2, 4));
  });

  it("never lets an edge cross the other, so the range is never empty or inverted", () => {
    expect(draggedLoopRange(bars(3, 4), "end", 4 * BAR, 0)).toEqual(bars(3, 3));
    expect(draggedLoopRange(bars(3, 4), "start", 2 * BAR, 10 * BAR)).toEqual(bars(4, 4));
    expect(draggedLoopRange(bars(1, 2), "start", 0, -5 * BAR)).toEqual(bars(1, 2));
  });

  it("moves the whole range by whole bars from the middle, keeping its length", () => {
    expect(draggedLoopRange(bars(1, 2), "body", BAR, 3 * BAR + 40)).toEqual(bars(3, 4));
    expect(draggedLoopRange(bars(3, 4), "body", 3 * BAR, -10 * BAR)).toEqual(bars(1, 2));
  });
});

describe("createLoopBraceDrag", () => {
  function setUp(options: { analyticsEnabled?: boolean } = {}) {
    const history = new CommandHistory(createSliceFixtureProject());
    const transport = createRecordingTransport();
    const consent = new ConsentStore(memoryStorage());
    consent.set({ productAnalytics: options.analyticsEnabled ?? true });
    const analytics = new Analytics({ transport, consent, storage: memoryStorage() });
    const projects: number[] = [];
    const drag = createLoopBraceDrag({
      getLoop: () => history.project.song.loop,
      beginGesture: (summary) => {
        const gesture = history.beginGesture({ summary });
        return {
          apply: (commands) => {
            gesture.apply(commands);
            projects.push(history.project.song.loop.endTicks);
          },
          commit: () => gesture.commit(),
          cancel: () => gesture.cancel(),
        };
      },
      analytics,
    });
    return { history, transport, drag, projects };
  }

  let ctx: ReturnType<typeof setUp>;
  beforeEach(() => {
    ctx = setUp();
  });

  it("applies every step live and commits the drag as one entry and one revision", () => {
    const { history, drag, projects } = ctx;
    const revision = history.project.metadata.revision;

    expect(drag.begin("end", BAR)).toBe(true);
    drag.update(1.4 * BAR); // still bar 1: nothing to apply
    drag.update(2 * BAR);
    drag.update(3 * BAR);
    drag.update(2.1 * BAR);
    drag.end();

    expect(projects).toEqual([2 * BAR, 3 * BAR, 2 * BAR]);
    expect(history.project.song.loop).toMatchObject(bars(1, 2));
    expect(history.entries).toHaveLength(1);
    expect(history.project.metadata.revision).toBe(revision + 1);
    expect(drag.isDragging()).toBe(false);
  });

  it("logs loop_range_set once per drag, carrying only the bar count", () => {
    const { drag, transport } = ctx;
    drag.begin("end", BAR);
    drag.update(2 * BAR);
    drag.update(4 * BAR);
    drag.end();

    const events = transport.named("loop_range_set");
    expect(events).toHaveLength(1);
    expect(events[0]?.params.bar_count).toBe(4);
    // No project, track, or clip name rides along with it.
    const project = ctx.history.project;
    const names = [
      project.metadata.name,
      ...project.song.tracks.map((track) => track.name),
      ...project.clips.map((clip) => clip.name),
    ];
    const values = Object.values(events[0]?.params ?? {}).map(String);
    for (const name of names) expect(values).not.toContain(name);
  });

  it("leaves no entry and logs nothing for a drag that ends where it began", () => {
    const { history, drag, transport } = ctx;
    drag.begin("body", 0.5 * BAR);
    drag.update(2 * BAR);
    drag.update(0.6 * BAR);
    drag.end();

    expect(history.project.song.loop).toMatchObject(bars(1, 1));
    expect(history.entries).toHaveLength(0);
    expect(transport.named("loop_range_set")).toHaveLength(0);
  });

  it("puts the brace back when the drag is cancelled", () => {
    const { history, drag } = ctx;
    drag.begin("end", BAR);
    drag.update(5 * BAR);
    drag.cancel();

    expect(history.project.song.loop).toMatchObject(bars(1, 1));
    expect(history.entries).toHaveLength(0);
  });

  it("edits the range identically with analytics disabled", () => {
    const off = setUp({ analyticsEnabled: false });
    off.drag.begin("end", BAR);
    off.drag.update(2 * BAR);
    off.drag.end();

    expect(off.history.project.song.loop).toMatchObject(bars(1, 2));
    expect(off.history.entries).toHaveLength(1);
    expect(off.transport.named("loop_range_set")).toHaveLength(0);
  });
});
