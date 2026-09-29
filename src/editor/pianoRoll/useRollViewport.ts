import { type Accessor, createSignal, onSettled } from "solid-js";
import { clampZoom, ROW_HEIGHT, scrollForZoom, ZOOM_FACTOR } from "./layout";
import "./PianoRoll.css";

/** The note-name gutter's width: the grid's visible area starts after it. */
export const GUTTER_WIDTH = 76;

export interface RollViewportOptions {
  /** The row index to centre when the roll opens (`focusRow`). */
  readonly focusRow: Accessor<number>;
}

/**
 * The roll's scroll and time zoom (ARR-010).
 *
 * The grid scrolls in one element and the ruler sits above it in another, so
 * the ruler can never cover a row; each keeps the other's horizontal offset.
 * Zoom changes step width only, from 50% to 200%: the toolbar zooms around the
 * middle of the visible grid, and a trackpad pinch or Ctrl+wheel around the
 * pointer. The roll opens scrolled so its focus row is in the middle.
 */
export function useRollViewport(options: RollViewportOptions) {
  const [zoom, setZoom] = createSignal(1);
  // The zoom as of the last change, read by the next one: a signal write is
  // only visible after the flush, and two zoom steps can land in one tick.
  let current = 1;
  let scroller: HTMLElement | undefined;
  let ruler: HTMLElement | undefined;

  /** Zooms time around `anchor`, in pixels from the visible grid's left edge. */
  function zoomTo(next: number, anchor: number): void {
    const from = current;
    const to = clampZoom(next);
    if (to === from) return;
    const left = scroller ? scrollForZoom(scroller.scrollLeft, anchor, from, to) : 0;
    current = to;
    setZoom(to);
    // After the grid has taken its new width, or the offset would be clamped.
    queueMicrotask(() => {
      if (scroller) scroller.scrollLeft = left;
    });
  }

  function zoomAroundCentre(factor: number): void {
    const visible = Math.max(0, (scroller?.clientWidth ?? 0) - GUTTER_WIDTH);
    zoomTo(current * factor, visible / 2);
  }

  function syncScroll(from: HTMLElement | undefined, to: HTMLElement | undefined): void {
    if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  }

  // A pinch arrives as a wheel event with ctrlKey held. The listener is not
  // passive, so the page itself does not zoom; a plain wheel still scrolls.
  onSettled(() => {
    const target = scroller;
    if (!target) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const anchor = event.clientX - target.getBoundingClientRect().left - GUTTER_WIDTH;
      zoomTo(current * Math.exp(-event.deltaY * 0.01), anchor);
    };
    target.addEventListener("wheel", onWheel, { passive: false });
    return () => target.removeEventListener("wheel", onWheel);
  });

  onSettled(() => {
    if (!scroller) return;
    const centre = options.focusRow() * ROW_HEIGHT + ROW_HEIGHT / 2;
    scroller.scrollTop = Math.max(0, centre - scroller.clientHeight / 2);
  });

  return {
    zoom,
    zoomIn: () => zoomAroundCentre(ZOOM_FACTOR),
    zoomOut: () => zoomAroundCentre(1 / ZOOM_FACTOR),
    /** The grid's scroller; its scroll event keeps the ruler in step. */
    scroller: (element: HTMLElement) => {
      scroller = element;
    },
    ruler: (element: HTMLElement) => {
      ruler = element;
    },
    onScrollerScroll: () => syncScroll(scroller, ruler),
    onRulerScroll: () => syncScroll(ruler, scroller),
    /** The live scroller, for auto-scroll during a drag. */
    scrollElement: () => scroller,
  };
}
