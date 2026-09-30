/**
 * The stems track list's selection model (EXP-004, "Tracks as a mini-arrangement"):
 * which rows are included, which are *picked*, and how clicks and keys change
 * both. Pure and framework-free, like `src/selection`: every function takes a
 * state and the ordered rows and returns the next state, so the dialog owns
 * the signal and this file owns every rule.
 *
 * It is export UI state, never saved. Like `stemSelection.ts` it records the
 * rows LEFT OUT, keyed by id, so a track added while the dialog is open is
 * included like the rest. "Picked" is a transient multi-selection that does not
 * change what is included until an action or a click on a picked row applies it.
 */

export interface TrackListRow {
  readonly id: string;
  /** Read-only and always included (a return): clicks and actions skip it. */
  readonly fixed?: boolean;
}

export interface TrackListState {
  readonly leftOut: ReadonlySet<string>;
  readonly picked: ReadonlySet<string>;
  /** The last clicked (or keyboard-anchored) row, where ranges start. */
  readonly anchor: string | null;
  /** The row the keyboard is on. */
  readonly focus: string | null;
}

export interface ClickModifiers {
  readonly shift?: boolean;
  /** Cmd on macOS, Ctrl elsewhere. */
  readonly meta?: boolean;
}

export type PickAction = "on" | "off" | "only" | "clear";

export interface KeyInput extends ClickModifiers {
  readonly key: string;
}

export interface KeyResult {
  readonly state: TrackListState;
  /** The key was ours: the caller prevents the default and stops it there. */
  readonly handled: boolean;
}

export const EMPTY_TRACK_LIST: TrackListState = {
  leftOut: new Set(),
  picked: new Set(),
  anchor: null,
  focus: null,
};

export function isIncluded(state: TrackListState, row: TrackListRow): boolean {
  return row.fixed === true || !state.leftOut.has(row.id);
}

/** The ids a stem export includes, in row order. */
export function includedIds(
  state: TrackListState,
  rows: readonly TrackListRow[],
): string[] {
  return rows.filter((row) => isIncluded(state, row)).map((row) => row.id);
}

function indexOf(rows: readonly TrackListRow[], id: string | null): number {
  return id === null ? -1 : rows.findIndex((row) => row.id === id);
}

function span(rows: readonly TrackListRow[], a: number, b: number): string[] {
  return rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((row) => row.id);
}

/** Set these ids on or off; a fixed row keeps its state. */
function setIncluded(
  leftOut: ReadonlySet<string>,
  rows: readonly TrackListRow[],
  ids: Iterable<string>,
  included: boolean,
): ReadonlySet<string> {
  const fixed = new Set(rows.filter((row) => row.fixed).map((row) => row.id));
  const next = new Set(leftOut);
  for (const id of ids) {
    if (fixed.has(id)) continue;
    if (included) next.delete(id);
    else next.add(id);
  }
  return next;
}

function metaClick(
  state: TrackListState,
  rows: readonly TrackListRow[],
  id: string,
  at: number,
  from: number,
  shift: boolean,
): TrackListState {
  const picked = new Set(state.picked);
  if (shift && from >= 0) {
    for (const inRange of span(rows, from, at)) picked.add(inRange);
    return { ...state, picked, focus: id };
  }
  if (picked.has(id)) picked.delete(id);
  else picked.add(id);
  return { ...state, picked, anchor: id, focus: id };
}

export function clickRow(
  state: TrackListState,
  rows: readonly TrackListRow[],
  id: string,
  mods: ClickModifiers = {},
): TrackListState {
  const at = indexOf(rows, id);
  const row = rows[at];
  if (!row) return state;
  const from = indexOf(rows, state.anchor);
  if (mods.meta) return metaClick(state, rows, id, at, from, mods.shift === true);
  const anchorRow = rows[from];
  if (mods.shift && anchorRow) {
    const value = isIncluded(state, anchorRow);
    return {
      ...state,
      leftOut: setIncluded(state.leftOut, rows, span(rows, from, at), value),
      picked: new Set(),
      focus: id,
    };
  }
  const value = !isIncluded(state, row);
  if (state.picked.has(id) && state.picked.size > 1) {
    return {
      ...state,
      leftOut: setIncluded(state.leftOut, rows, state.picked, value),
      anchor: id,
      focus: id,
    };
  }
  return {
    ...state,
    leftOut: setIncluded(state.leftOut, rows, [id], value),
    picked: new Set(),
    anchor: id,
    focus: id,
  };
}

export function applyPickAction(
  state: TrackListState,
  rows: readonly TrackListRow[],
  action: PickAction,
): TrackListState {
  const { leftOut, picked } = state;
  switch (action) {
    case "on":
      return { ...state, leftOut: setIncluded(leftOut, rows, picked, true) };
    case "off":
      return { ...state, leftOut: setIncluded(leftOut, rows, picked, false) };
    case "only": {
      const others = rows.map((r) => r.id).filter((id) => !picked.has(id));
      const withPicked = setIncluded(leftOut, rows, picked, true);
      return { ...state, leftOut: setIncluded(withPicked, rows, others, false) };
    }
    case "clear":
      return { ...state, picked: new Set() };
  }
}

function moveFocus(
  state: TrackListState,
  rows: readonly TrackListRow[],
  delta: number,
  extend: boolean,
): TrackListState {
  const current = Math.max(0, indexOf(rows, state.focus));
  const next = Math.min(rows.length - 1, Math.max(0, current + delta));
  const focus = (rows[next] as TrackListRow).id;
  if (!extend) return { ...state, focus };
  const anchor = state.anchor ?? (rows[current] as TrackListRow).id;
  const picked = new Set(span(rows, indexOf(rows, anchor), next));
  return { ...state, anchor, focus, picked };
}

/**
 * One key on the list. `handled` is false for a key that is not ours, and for
 * Escape with nothing picked, so the dialog closes only when there was nothing
 * to clear.
 */
export function handleKey(
  state: TrackListState,
  rows: readonly TrackListRow[],
  input: KeyInput,
): KeyResult {
  const ignored = { state, handled: false };
  if (rows.length === 0) return ignored;
  const { key } = input;
  if (key === "ArrowDown" || key === "ArrowUp") {
    const delta = key === "ArrowDown" ? 1 : -1;
    return {
      state: moveFocus(state, rows, delta, input.shift === true),
      handled: true,
    };
  }
  if (key === " " || key === "Enter") {
    const target = state.focus ?? (rows[0] as TrackListRow).id;
    return { state: clickRow(state, rows, target), handled: true };
  }
  if (input.meta && key.toLowerCase() === "a") {
    const picked = new Set(rows.map((row) => row.id));
    return { state: { ...state, picked }, handled: true };
  }
  if (key === "Escape" && state.picked.size > 0) {
    return { state: applyPickAction(state, rows, "clear"), handled: true };
  }
  return ignored;
}
