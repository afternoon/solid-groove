import { type Accessor, createSignal, onCleanup } from "solid-js";
import type { TrackId } from "../domain/ids";
import { dropSlot, slotToIndex } from "./trackReorder";

/**
 * Drag a track to a new position (TRK-02, #331). The arrangement's header
 * column and the mixer's strip row share this controller, each along its axis.
 *
 * Nothing touches the project mid-drag: the drag publishes where the track
 * *would* land as `target`, and a view previews it there. Letting go inside the
 * zone calls `onDrop` once — one `track.reorder`, one revision, one history
 * entry; letting go anywhere else, or where the track already is, calls nothing.
 *
 * Items are read off the DOM by `data-track-drag` (the arrangement renders only
 * the rows in view), placed in the whole song by `indexOf`, and measured once
 * at drag start, since the preview moves them.
 */
export interface TrackDragOptions {
  readonly axis: "x" | "y";
  /** The element that bounds a valid drop. */
  zone(): HTMLElement | undefined;
  /** A track's position in display order. */
  indexOf(trackId: TrackId): number;
  onDrop(trackId: TrackId, toIndex: number): void;
}

export interface TrackDrag {
  /** Start a drag from a handle's `pointerdown`. */
  begin(event: PointerEvent, trackId: TrackId): void;
  /** The track being dragged, once the pointer has passed the threshold. */
  readonly dragging: Accessor<TrackId | null>;
  /** The display index letting go now would move the dragged track to, or
   * null when it would change nothing. */
  readonly target: Accessor<number | null>;
}

/** How far the pointer travels before a press becomes a drag, in px. */
const DRAG_THRESHOLD_PX = 4;

export function useTrackDrag(options: TrackDragOptions): TrackDrag {
  const [dragging, setDragging] = createSignal<TrackId | null>(null);
  const [targetIndex, setTargetIndex] = createSignal<number | null>(null);
  let teardown: (() => void) | null = null;

  const y = options.axis === "y";

  /** A client position along the axis, in the zone's scrolled content — so a
   * measurement taken at drag start stays valid while the zone scrolls. */
  function along(zone: HTMLElement, client: number): number {
    const box = zone.getBoundingClientRect();
    return client - (y ? box.top : box.left) + (y ? zone.scrollTop : zone.scrollLeft);
  }

  type Item = { readonly index: number; readonly middle: number };

  function measure(zone: HTMLElement): Item[] {
    return [...zone.querySelectorAll<HTMLElement>("[data-track-drag]")].map((el) => {
      const r = el.getBoundingClientRect();
      const id = el.dataset.trackDrag as TrackId;
      const middle = along(zone, y ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2);
      return { index: options.indexOf(id), middle };
    });
  }

  /** The display index letting go at `event` would move the track to. */
  function target(event: PointerEvent, zone: HTMLElement, from: number, items: Item[]) {
    const box = zone.getBoundingClientRect();
    const { clientX: px, clientY: py } = event;
    const inside = px >= box.left && px <= box.right && py >= box.top && py <= box.bottom;
    const last = items.at(-1);
    if (!inside || !last) return null;
    const middles = items.map(({ middle }) => middle);
    const k = dropSlot(along(zone, y ? py : px), middles);
    const toIndex = slotToIndex(from, k < items.length ? items[k].index : last.index + 1);
    return toIndex === from ? null : toIndex;
  }

  function end(): void {
    teardown?.();
    teardown = null;
    setTargetIndex(null);
    setDragging(null);
  }

  function begin(event: PointerEvent, trackId: TrackId): void {
    const zone = options.zone();
    if (event.button !== 0 || !zone) return;
    end();
    const fromIndex = options.indexOf(trackId);
    const origin = { x: event.clientX, y: event.clientY };
    let active = false;
    let toIndex: number | null = null;
    let measured: Item[] = [];

    const onMove = (move: PointerEvent) => {
      if (!active) {
        const moved = Math.hypot(move.clientX - origin.x, move.clientY - origin.y);
        if (moved < DRAG_THRESHOLD_PX) return;
        active = true;
        measured = measure(zone);
        setDragging(trackId);
      }
      toIndex = target(move, zone, fromIndex, measured);
      setTargetIndex(toIndex);
    };
    const onUp = () => {
      const drop = active ? toIndex : null;
      if (active) swallowNextClick();
      end();
      if (drop !== null) options.onDrop(trackId, drop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", end);
    teardown = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", end);
    };
  }

  onCleanup(() => teardown?.());

  return { begin, dragging, target: targetIndex };
}

/**
 * A drag still ends in a `click`, which would select the track. Swallow it; it
 * comes right after `pointerup` if at all, so a new task or press ends the wait.
 */
function swallowNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    stop();
  };
  const stop = () => {
    window.removeEventListener("click", swallow, { capture: true });
    window.removeEventListener("pointerdown", stop, { capture: true });
  };
  window.addEventListener("click", swallow, { capture: true });
  window.addEventListener("pointerdown", stop, { capture: true });
  setTimeout(stop, 0);
}
