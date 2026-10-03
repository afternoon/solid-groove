// Where the assistant panel is, and how big (#849, AI-004a).
//
// A plain value and pure transitions over it, so every rule the panel follows
// (the three homes, the size limits, the keyboard steps, the reset, and what a
// device remembers) is testable without rendering anything. The component
// holds one of these in a signal and hands every change back through here.
//
// The panel's place belongs to this device, not to the project and not to the
// account: it is kept in local storage under one versioned key, never synced
// and never saved with a song.

/**
 * Where the panel is. Floating sits bottom-right over the editor and covers
 * it; minimised is a bar in the same corner; docked is a column at the right
 * edge the views reflow around; closed is hidden.
 */
export type AssistantPanelMode = "floating" | "minimised" | "docked" | "closed";

/** The two homes the panel opens into. */
export type AssistantPanelHome = "floating" | "docked";

/** A size the panel can be dragged or stepped to, and the one it resets to. */
export interface SizeRange {
  readonly min: number;
  readonly max: number;
  readonly initial: number;
}

/**
 * The floating panel's height, set by dragging its top edge. A window shorter
 * than this leaves less room, and the panel never grows past it: see
 * `floatingRoom`.
 */
export const FLOATING_HEIGHT: SizeRange = { min: 260, max: 1000, initial: 560 };

/**
 * What the editor keeps clear above a floating panel: its header and the
 * dividers either side of it (`--editor-header-height` and `--size-divider`
 * in EditorView.css), so the transport and the Assistant button stay in reach.
 */
export const FLOATING_TOP_CLEARANCE = 50;

/** The docked panel's width, set by dragging its left edge. */
export const DOCKED_WIDTH: SizeRange = { min: 300, max: 640, initial: 384 };

/** The floating panel's width, which is fixed. */
export const FLOATING_WIDTH = 384;

/** The minimised bar's height. */
export const MINIMISED_HEIGHT = 40;

/** One arrow press on a focused edge, and one with Shift. */
export const RESIZE_STEP = 16;
export const RESIZE_STEP_LARGE = 64;

export interface AssistantPanelLayout {
  readonly mode: AssistantPanelMode;
  /** Where the panel opens next time it is opened from closed. */
  readonly home: AssistantPanelHome;
  /** The floating height, kept while the panel is elsewhere. */
  readonly height: number;
  /** The docked width, kept while the panel is elsewhere. */
  readonly width: number;
}

/** A device that has never opened the assistant. */
export const DEFAULT_LAYOUT: AssistantPanelLayout = {
  mode: "closed",
  home: "floating",
  height: FLOATING_HEIGHT.initial,
  width: DOCKED_WIDTH.initial,
};

/** Whether the panel is on screen at all, as a bar or a panel. */
export function isOpen(layout: AssistantPanelLayout): boolean {
  return layout.mode !== "closed";
}

/** Whether the panel shows its body, so has a resize edge and takes focus. */
export function isExpanded(layout: AssistantPanelLayout): boolean {
  return layout.mode === "floating" || layout.mode === "docked";
}

/** The header button and Cmd/Ctrl+K: open where it was last, or close. */
export function toggle(layout: AssistantPanelLayout): AssistantPanelLayout {
  return isOpen(layout) ? close(layout) : { ...layout, mode: layout.home };
}

export function close(layout: AssistantPanelLayout): AssistantPanelLayout {
  return { ...layout, mode: "closed" };
}

/** Only a floating panel minimises; the bar sits where it floated. */
export function minimise(layout: AssistantPanelLayout): AssistantPanelLayout {
  return layout.mode === "floating" ? { ...layout, mode: "minimised" } : layout;
}

export function float(layout: AssistantPanelLayout): AssistantPanelLayout {
  return { ...layout, mode: "floating", home: "floating" };
}

export function dock(layout: AssistantPanelLayout): AssistantPanelLayout {
  return { ...layout, mode: "docked", home: "docked" };
}

/**
 * Escape inside the panel: a floating panel minimises and a docked one closes.
 * `undefined` where Escape means nothing to the panel, so the key is left to
 * whatever else wants it.
 */
export function dismiss(layout: AssistantPanelLayout): AssistantPanelLayout | undefined {
  if (layout.mode === "floating") return minimise(layout);
  if (layout.mode === "docked") return close(layout);
  return undefined;
}

/**
 * The most a floating panel can be in a window this tall: the height under
 * the editor's header, so the whole panel, its resize edge included, is
 * always on screen.
 */
export function floatingRoom(windowHeight: number): number {
  return Math.max(0, Math.floor(windowHeight - FLOATING_TOP_CLEARANCE));
}

/**
 * A range cut down to the room there is. Room short of the range's minimum
 * lowers the minimum with it, because staying on screen wins over the
 * minimum; the reset size is pulled in to fit.
 */
export function fitRange(range: SizeRange, room: number): SizeRange {
  const max = Math.min(range.max, room);
  if (max >= range.max) return range;
  const min = Math.min(range.min, max);
  return { min, max, initial: Math.min(range.initial, max) };
}

/**
 * The size the resize edge controls in this mode, if it has one, and the
 * limits it moves within. `room` is the floating height the window has
 * (`floatingRoom`); the value is what is on screen, so a remembered height
 * taller than the window reads as the room it has.
 */
export function resizable(
  layout: AssistantPanelLayout,
  room = Number.POSITIVE_INFINITY,
): { readonly value: number; readonly range: SizeRange } | undefined {
  if (layout.mode === "floating") {
    const range = fitRange(FLOATING_HEIGHT, room);
    return { value: Math.min(layout.height, range.max), range };
  }
  if (layout.mode === "docked") return { value: layout.width, range: DOCKED_WIDTH };
  return undefined;
}

export function clampSize(value: number, range: SizeRange): number {
  return Math.round(Math.min(range.max, Math.max(range.min, value)));
}

/**
 * Sets the size the edge controls (a drag), clamped to its limits and, while
 * floating, to the room the window has. A panel with no edge is returned
 * unchanged.
 */
export function setSize(
  layout: AssistantPanelLayout,
  value: number,
  room = Number.POSITIVE_INFINITY,
): AssistantPanelLayout {
  if (layout.mode === "floating") {
    return { ...layout, height: clampSize(value, fitRange(FLOATING_HEIGHT, room)) };
  }
  if (layout.mode === "docked") {
    return { ...layout, width: clampSize(value, DOCKED_WIDTH) };
  }
  return layout;
}

/** Moves the edge outward (positive) or inward (negative) by `by` pixels. */
export function resizeBy(
  layout: AssistantPanelLayout,
  by: number,
  room = Number.POSITIVE_INFINITY,
): AssistantPanelLayout {
  const current = resizable(layout, room);
  return current ? setSize(layout, current.value + by, room) : layout;
}

/** A double-click on the edge: back to the size this mode starts at. */
export function resetSize(
  layout: AssistantPanelLayout,
  room = Number.POSITIVE_INFINITY,
): AssistantPanelLayout {
  const current = resizable(layout, room);
  return current ? setSize(layout, current.range.initial, room) : layout;
}

// --- Remembered per device ---------------------------------------------------

/**
 * The one local-storage key. The version is part of the key, so a later shape
 * is a new key and this one is simply never read again.
 */
export const LAYOUT_STORAGE_KEY = "sg_assistant_panel_v1";

/** What is stored: the mode (floating, docked or closed), the home, both sizes. */
interface StoredLayout {
  readonly mode: "floating" | "docked" | "closed";
  readonly home: AssistantPanelHome;
  readonly height: number;
  readonly width: number;
}

const STORED_MODES: readonly string[] = ["floating", "docked", "closed"];
const HOMES: readonly string[] = ["floating", "docked"];

function inRange(value: unknown, range: SizeRange): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= range.min &&
    value <= range.max
  );
}

/**
 * Reads a stored value. Anything unreadable, missing or out of range falls
 * back to its default, field by field, so a bad value can cost a size but
 * never produce a broken layout.
 */
export function parseLayout(raw: string | null): AssistantPanelLayout {
  if (raw === null) return DEFAULT_LAYOUT;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_LAYOUT;
  }
  if (typeof value !== "object" || value === null) return DEFAULT_LAYOUT;
  const stored = value as Partial<Record<keyof StoredLayout, unknown>>;
  const mode =
    typeof stored.mode === "string" && STORED_MODES.includes(stored.mode)
      ? (stored.mode as StoredLayout["mode"])
      : DEFAULT_LAYOUT.mode;
  const home =
    typeof stored.home === "string" && HOMES.includes(stored.home)
      ? (stored.home as AssistantPanelHome)
      : DEFAULT_LAYOUT.home;
  return {
    mode,
    home,
    height: inRange(stored.height, FLOATING_HEIGHT)
      ? stored.height
      : DEFAULT_LAYOUT.height,
    width: inRange(stored.width, DOCKED_WIDTH) ? stored.width : DEFAULT_LAYOUT.width,
  };
}

/** The stored form. A minimised panel is remembered as floating. */
export function serializeLayout(layout: AssistantPanelLayout): string {
  const stored: StoredLayout = {
    mode: layout.mode === "minimised" ? "floating" : layout.mode,
    home: layout.home,
    height: layout.height,
    width: layout.width,
  };
  return JSON.stringify(stored);
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** This device's layout, or the defaults if storage is missing or unreadable. */
export function loadLayout(
  storage: Storage | null = safeStorage(),
): AssistantPanelLayout {
  if (!storage) return DEFAULT_LAYOUT;
  try {
    return parseLayout(storage.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/**
 * Remembers the layout on this device. Best effort: private browsing or a full
 * quota costs the memory, never the panel.
 */
export function saveLayout(
  layout: AssistantPanelLayout,
  storage: Storage | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(layout));
  } catch {
    // Nothing to do: the panel works the same, it just forgets on reload.
  }
}
