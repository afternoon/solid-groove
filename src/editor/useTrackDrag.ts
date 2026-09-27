import { type Accessor, createSignal, onCleanup } from "solid-js";
import type { TrackId } from "../domain/ids";
import { dropSlot, slotToIndex } from "./trackReorder";

/**
 * Drag a track to a new position (TRK-02, #331). The arrangement's header
 * column and the mixer's strip row share this controller, each along its axis.
 *
 * Nothing touches the project while the pointer moves: the drag only works out
 * where the track *would* land and publishes that as `target`, which a view
 * previews by drawing the track there already. Letting go inside
 * the zone calls `onDrop` once, so a whole drag is one `track.reorder`, one
 * revision and one history entry; letting go anywhere else, or where the track
 * already is, calls nothing.
 *
 * Items are read off the DOM — each carries `data-track-drag` (its track id) —
 * because the arrangement renders only the rows in view. `indexOf` places them
 * in the whole song, not among the rendered rows. They are measured once, when
 * the drag starts: the preview re-lays them out mid-drag, and measuring the
 * moved items would shift the slots the pointer is judged against.
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

  const span = (rect: DOMRect) =>
    options.axis === "y" ? [rect.top, rect.bottom] : [rect.left, rect.right];

  type Item = { readonly index: number; readonly span: number[] };

  /** Each item's display index and its span along the axis, in the zone's
   * scrolled content — so a measurement stays valid while the zone scrolls. */
  function measure(zone: HTMLElement): Item[] {
    const start = span(zone.getBoundingClientRect())[0];
    const scroll = options.axis === "y" ? zone.scrollTop : zone.scrollLeft;
    return [...zone.querySelectorAll<HTMLElement>("[data-track-drag]")].map((el) => ({
      index: options.indexOf(el.dataset.trackDrag as TrackId),
      span: span(el.getBoundingClientRect()).map((edge) => edge - start + scroll),
    }));
  }

  /** The display index letting go at the pointer would move the track to. */
  function target(
    event: PointerEvent,
    zone: HTMLElement,
    fromIndex: number,
    items: readonly Item[],
  ): number | null {
    const box = zone.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    const last = items.at(-1);
    if (!inside || !last) return null;
    const scroll = options.axis === "y" ? zone.scrollTop : zone.scrollLeft;
    const pointer =
      (options.axis === "y" ? event.clientY : event.clientX) - span(box)[0] + scroll;
    const k = dropSlot(
      pointer,
      items.map(({ span: [start, end] }) => (start + end) / 2),
    );
    const slot = k < items.length ? items[k].index : last.index + 1;
    const toIndex = slotToIndex(fromIndex, slot);
    return toIndex === fromIndex ? null : toIndex;
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
        if (
          Math.hypot(move.clientX - origin.x, move.clientY - origin.y) < DRAG_THRESHOLD_PX
        )
          return;
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
 * A drag that ends on the handle it began on still produces a `click` there,
 * which would select the track as if it had been clicked. Swallow that one
 * click; it arrives synchronously after `pointerup`, if at all.
 */
function swallowNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}
