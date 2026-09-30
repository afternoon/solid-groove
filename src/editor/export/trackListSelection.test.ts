import { describe, expect, it } from "vitest";
import {
  applyPickAction,
  clickRow,
  EMPTY_TRACK_LIST,
  includedIds,
  isIncluded,
  type ListCommand,
  runListCommand,
  type TrackListRow,
  type TrackListState,
} from "./trackListSelection";

const rows: TrackListRow[] = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
const ids = (set: ReadonlySet<string>) => [...set].sort();
const left = (s: TrackListState) => ids(s.leftOut);
const mk = (over: Partial<TrackListState> = {}): TrackListState => ({
  ...EMPTY_TRACK_LIST,
  ...over,
});

describe("clickRow", () => {
  it("includes every row by default, including one added later", () => {
    expect(includedIds(EMPTY_TRACK_LIST, rows)).toEqual(["a", "b", "c", "d", "e"]);
    expect(includedIds(EMPTY_TRACK_LIST, [...rows, { id: "f" }])).toHaveLength(6);
  });

  it("flips one row and anchors on it", () => {
    const s = clickRow(EMPTY_TRACK_LIST, rows, "b");
    expect(left(s)).toEqual(["b"]);
    expect(s.anchor).toBe("b");
    expect(left(clickRow(s, rows, "b"))).toEqual([]);
  });

  it("clears picks on a plain click of an unpicked row", () => {
    const s = clickRow(mk({ picked: new Set(["a", "b"]) }), rows, "d");
    expect(s.picked.size).toBe(0);
    expect(left(s)).toEqual(["d"]);
  });

  it("flips every picked row together from a click on a picked row", () => {
    const start = mk({ picked: new Set(["a", "b", "c"]) });
    const off = clickRow(start, rows, "b");
    expect(left(off)).toEqual(["a", "b", "c"]);
    expect(ids(off.picked)).toEqual(["a", "b", "c"]);
    expect(left(clickRow(off, rows, "b"))).toEqual([]);
  });

  it("treats a single picked row like an ordinary click", () => {
    const s = clickRow(mk({ picked: new Set(["b"]) }), rows, "b");
    expect(left(s)).toEqual(["b"]);
    expect(s.picked.size).toBe(0);
  });

  it("shift-click sets the range to the anchor's state and clears picks", () => {
    const off = clickRow(EMPTY_TRACK_LIST, rows, "b");
    const s = clickRow({ ...off, picked: new Set(["e"]) }, rows, "d", {
      shift: true,
    });
    expect(left(s)).toEqual(["b", "c", "d"]);
    expect(s.picked.size).toBe(0);
    const back = clickRow(mk({ anchor: "d", leftOut: new Set(["a", "b"]) }), rows, "a", {
      shift: true,
    });
    expect(left(back)).toEqual([]);
  });

  it("shift-click without an anchor is a plain click", () => {
    const s = clickRow(EMPTY_TRACK_LIST, rows, "c", { shift: true });
    expect(left(s)).toEqual(["c"]);
  });

  it("meta-click toggles a pick without changing inclusion", () => {
    const one = clickRow(EMPTY_TRACK_LIST, rows, "b", { meta: true });
    expect(ids(one.picked)).toEqual(["b"]);
    expect(one.anchor).toBe("b");
    expect(left(one)).toEqual([]);
    expect(clickRow(one, rows, "b", { meta: true }).picked.size).toBe(0);
  });

  it("meta+shift adds the anchor range to the picks", () => {
    const one = clickRow(EMPTY_TRACK_LIST, rows, "b", { meta: true });
    const s = clickRow(one, rows, "d", { meta: true, shift: true });
    expect(ids(s.picked)).toEqual(["b", "c", "d"]);
    expect(left(s)).toEqual([]);
  });

  it("ignores an unknown id", () => {
    expect(clickRow(EMPTY_TRACK_LIST, rows, "zz")).toBe(EMPTY_TRACK_LIST);
  });

  it("never changes a fixed row", () => {
    const withFixed: TrackListRow[] = [...rows, { id: "r", fixed: true }];
    expect(isIncluded(EMPTY_TRACK_LIST, { id: "r", fixed: true })).toBe(true);
    expect(left(clickRow(EMPTY_TRACK_LIST, withFixed, "r"))).toEqual([]);
    const range = clickRow(mk({ anchor: "a", leftOut: new Set(["a"]) }), withFixed, "r", {
      shift: true,
    });
    expect(left(range)).toEqual(["a", "b", "c", "d", "e"]);
    const off = applyPickAction(mk({ picked: new Set(["r", "a"]) }), withFixed, "off");
    expect(left(off)).toEqual(["a"]);
    const only = applyPickAction(mk({ picked: new Set(["a"]) }), withFixed, "only");
    expect(left(only)).toEqual(["b", "c", "d", "e"]);
  });
});

describe("applyPickAction", () => {
  const picked = new Set(["b", "c"]);

  it("turns the picked rows on or off and keeps the picks", () => {
    const off = applyPickAction(mk({ picked }), rows, "off");
    expect(left(off)).toEqual(["b", "c"]);
    expect(ids(off.picked)).toEqual(["b", "c"]);
    expect(left(applyPickAction(off, rows, "on"))).toEqual([]);
  });

  it("only these includes the picked rows and leaves out the rest", () => {
    const s = applyPickAction(mk({ picked, leftOut: new Set(["b"]) }), rows, "only");
    expect(left(s)).toEqual(["a", "d", "e"]);
  });

  it("clear empties the picks only", () => {
    const s = applyPickAction(mk({ picked, leftOut: new Set(["a"]) }), rows, "clear");
    expect(s.picked.size).toBe(0);
    expect(left(s)).toEqual(["a"]);
  });
});

describe("runListCommand", () => {
  const run = (s: TrackListState, c: ListCommand) => runListCommand(s, rows, c);

  it("moves focus and clamps at both ends", () => {
    let s = mk({ focus: "a" });
    s = run(s, "focus_prev").state;
    expect(s.focus).toBe("a");
    s = run(s, "focus_next").state;
    expect(s.focus).toBe("b");
    expect(run(mk({ focus: "e" }), "focus_next").state.focus).toBe("e");
    expect(run(EMPTY_TRACK_LIST, "focus_next").state.focus).toBe("b");
  });

  it("extending picks a run from the anchor", () => {
    let s = mk({ focus: "b" });
    s = run(s, "extend_next").state;
    s = run(s, "extend_next").state;
    expect(ids(s.picked)).toEqual(["b", "c", "d"]);
    s = run(s, "extend_prev").state;
    expect(ids(s.picked)).toEqual(["b", "c"]);
    expect(s.anchor).toBe("b");
  });

  it("flip clicks the focused row, or all picked rows", () => {
    expect(left(run(mk({ focus: "c" }), "flip").state)).toEqual(["c"]);
    const s = run(mk({ focus: "b", picked: new Set(["b", "d"]) }), "flip").state;
    expect(left(s)).toEqual(["b", "d"]);
  });

  it("pick_all picks every row", () => {
    const r = run(EMPTY_TRACK_LIST, "pick_all");
    expect(r.handled).toBe(true);
    expect(r.state.picked.size).toBe(5);
  });

  it("clear_picks is consumed only when something was picked", () => {
    const r = run(mk({ picked: new Set(["a"]) }), "clear_picks");
    expect(r.handled).toBe(true);
    expect(r.state.picked.size).toBe(0);
    const again = run(r.state, "clear_picks");
    expect(again.handled).toBe(false);
    expect(again.state).toBe(r.state);
  });

  it("does nothing on an empty list", () => {
    expect(runListCommand(EMPTY_TRACK_LIST, [], "focus_next").handled).toBe(false);
  });
});
