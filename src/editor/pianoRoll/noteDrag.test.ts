import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdFactory } from "../../domain/ids";
import { createChromaticKey } from "../../domain/musicalKey";
import { startAutoScroll } from "./autoScroll";
import { pitchOf } from "./edits";
import { type NoteGrab, ROW_HEIGHT } from "./layout";
import { startNoteDrag } from "./noteDrag";
import { setUpRoll } from "./rollHarness";
import { visibleRows } from "./rows";

afterEach(() => vi.unstubAllGlobals());

/** A drag host over the harness session, with `selected` as the selection. */
async function setUp(selected: number[] = []) {
  const roll = await setUpRoll();
  let selection = new Set(selected.map((index) => roll.notes()[index].id));
  const audition = vi.fn();
  const host = {
    clip: () => roll.session.project.clips[0],
    notes: roll.notes,
    rows: () => visibleRows(createChromaticKey(), roll.notes().map(pitchOf)),
    zoom: () => 1,
    selected: () => selection,
    setSelection: (ids: ReadonlySet<ReturnType<typeof roll.notes>[number]["id"]>) => {
      selection = new Set(ids);
    },
    beginGesture: roll.session.beginGesture.bind(roll.session),
    audition,
    ids: createIdFactory(),
  };
  const drag = (index: number, grab: NoteGrab, copy = false) =>
    startNoteDrag(host, roll.notes()[index], grab, copy);
  const summary = () =>
    roll
      .notes()
      .map((note) => [pitchOf(note), note.startTicks / 48, note.durationTicks / 48]);
  return { ...roll, host, drag, summary, audition, selection: () => selection };
}

describe("note drag", () => {
  it("moves the selection by steps and rows, as one undo entry", async () => {
    const { drag, summary, session, audition } = await setUp([0, 1]);
    const moving = drag(0, "body");
    moving?.update(80, 0);
    moving?.update(80, -2 * ROW_HEIGHT);
    expect(moving?.finish()).toBe(2);
    expect(summary().slice(0, 2)).toEqual([
      [62, 2, 1],
      [66, 6, 1],
    ]);
    // It played the anchor's new pitch once, when the rows changed.
    expect(audition).toHaveBeenCalledOnce();
    expect(audition).toHaveBeenCalledWith(62, 0.9);
    session.undo();
    expect(summary()[0]).toEqual([60, 0, 1]);
  });

  it("lands back where it started when the pointer comes back", async () => {
    const { drag, summary } = await setUp();
    const moving = drag(2, "body");
    moving?.update(200, 90);
    moving?.update(0, 0);
    moving?.finish();
    expect(summary()[2]).toEqual([67, 8, 1]);
  });

  it("resizes from either end and reports the new length", async () => {
    const { drag, summary } = await setUp();
    const end = drag(0, "end");
    end?.update(81, 0);
    end?.finish();
    expect(summary()[0]).toEqual([60, 0, 3]);
    expect(end?.resizedTicks()).toBe(3 * 48);

    const start = drag(2, "start");
    start?.update(-80, 30);
    start?.finish();
    expect(summary()[2]).toEqual([67, 6, 3]);
  });

  it("copies first when asked, moving the copies and selecting them", async () => {
    const { drag, summary, session, selection, notes } = await setUp([0]);
    const copying = drag(0, "body", true);
    copying?.update(320, 0);
    expect(copying?.finish()).toBe(1);
    expect(summary()).toHaveLength(5);
    expect(summary()[0]).toEqual([60, 0, 1]);
    expect(summary()[4]).toEqual([60, 8, 1]);
    expect([...selection()]).toEqual([notes()[4].id]);
    session.undo();
    expect(summary()).toHaveLength(4);
  });

  it("leaves the clip as it was when cancelled", async () => {
    const { drag, summary } = await setUp();
    const before = summary();
    const moving = drag(1, "body");
    moving?.update(120, 60);
    moving?.cancel();
    expect(summary()).toEqual(before);
  });
});

describe("auto-scroll", () => {
  it("scrolls toward the edge the pointer is near, and replays the pointer", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const scroller = document.createElement("div");
    scroller.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    const onScrolled = vi.fn();
    const stop = startAutoScroll({
      scroller: () => scroller,
      pointer: () => ({ clientX: 395, clientY: 150 }),
      leftInset: 76,
      onScrolled,
    });
    frames.shift()?.(0);
    expect(scroller.scrollLeft).toBeGreaterThan(0);
    expect(scroller.scrollTop).toBe(0);
    expect(onScrolled).toHaveBeenCalledOnce();
    stop();
  });
});
