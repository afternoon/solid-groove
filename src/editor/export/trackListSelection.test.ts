import { describe, expect, it } from "vitest";
import {
  applyPickAction,
  clickRow,
  EMPTY_TRACK_LIST,
  handleKey,
  includedIds,
  isIncluded,
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

describe("handleKey", () => {
  const key = (
    s: TrackListState,
    k: string,
    m: { shift?: boolean; meta?: boolean } = {},
  ) => handleKey(s, rows, { key: k, ...m });

  it("moves focus and clamps at both ends", () => {
    let s = mk({ focus: "a" });
    s = key(s, "ArrowUp").state;
    expect(s.focus).toBe("a");
    s = key(s, "ArrowDown").state;
    expect(s.focus).toBe("b");
    expect(key(mk({ focus: "e" }), "ArrowDown").state.focus).toBe("e");
    expect(key(EMPTY_TRACK_LIST, "ArrowDown").state.focus).toBe("b");
  });

  it("shift+arrow picks a run from the anchor", () => {
    let s = mk({ focus: "b" });
    s = key(s, "ArrowDown", { shift: true }).state;
    s = key(s, "ArrowDown", { shift: true }).state;
    expect(ids(s.picked)).toEqual(["b", "c", "d"]);
    s = key(s, "ArrowUp", { shift: true }).state;
    expect(ids(s.picked)).toEqual(["b", "c"]);
    expect(s.anchor).toBe("b");
  });

  it("space and enter click the focused row, or all picked rows", () => {
    expect(left(key(mk({ focus: "c" }), " ").state)).toEqual(["c"]);
    expect(left(key(mk({ focus: "c" }), "Enter").state)).toEqual(["c"]);
    const s = key(mk({ focus: "b", picked: new Set(["b", "d"]) }), " ").state;
    expect(left(s)).toEqual(["b", "d"]);
  });

  it("meta+A picks all", () => {
    const r = key(EMPTY_TRACK_LIST, "a", { meta: true });
    expect(r.handled).toBe(true);
    expect(r.state.picked.size).toBe(5);
    expect(key(EMPTY_TRACK_LIST, "a").handled).toBe(false);
  });

  it("Escape is consumed only when something was picked", () => {
    const r = key(mk({ picked: new Set(["a"]) }), "Escape");
    expect(r.handled).toBe(true);
    expect(r.state.picked.size).toBe(0);
    const again = key(r.state, "Escape");
    expect(again.handled).toBe(false);
    expect(again.state).toBe(r.state);
  });

  it("ignores other keys and an empty list", () => {
    expect(key(EMPTY_TRACK_LIST, "x").handled).toBe(false);
    expect(handleKey(EMPTY_TRACK_LIST, [], { key: "ArrowDown" }).handled).toBe(false);
  });
});
