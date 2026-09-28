import { autoScrollSpeed } from "./layout";

export interface AutoScrollOptions {
  readonly scroller: () => HTMLElement | undefined;
  /** Where the pointer is now, in client pixels. */
  readonly pointer: () => { clientX: number; clientY: number } | null;
  /** The visible grid starts this far in from the scroller's left edge. */
  readonly leftInset: number;
  /** Called after each frame that scrolled, to replay the pointer's position. */
  onScrolled(): void;
}

/**
 * Scrolls the roll while a drag holds the pointer near one of its edges,
 * faster the closer it gets, one step per animation frame (ARR-010). Returns
 * the function that stops it. Where there is no animation frame (jsdom), it
 * does nothing, which is also what a drag well inside the roll does.
 */
export function startAutoScroll(options: AutoScrollOptions): () => void {
  if (typeof requestAnimationFrame !== "function") return () => {};
  let frame = requestAnimationFrame(step);
  function step(): void {
    const scroller = options.scroller();
    const pointer = options.pointer();
    if (scroller && pointer) {
      const rect = scroller.getBoundingClientRect();
      const dx = autoScrollSpeed(
        pointer.clientX,
        rect.left + options.leftInset,
        rect.right,
      );
      const dy = autoScrollSpeed(pointer.clientY, rect.top, rect.bottom);
      const before = [scroller.scrollLeft, scroller.scrollTop];
      scroller.scrollLeft += dx;
      scroller.scrollTop += dy;
      if (scroller.scrollLeft !== before[0] || scroller.scrollTop !== before[1]) {
        options.onScrolled();
      }
    }
    frame = requestAnimationFrame(step);
  }
  return () => cancelAnimationFrame(frame);
}
