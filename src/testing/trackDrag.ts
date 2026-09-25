import { fireEvent } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { vi } from "vitest";

/**
 * Drives a track drag (TRK-02) in jsdom, which lays nothing out: every box is
 * zero-sized there, so the drag controller would see no geometry at all.
 *
 * `stubTrackDragLayout` gives each `[data-track-drag]` item a `size`-px box at
 * its track's position in `order()` along the axis, and the zone a box
 * `zoneLength` long; everything else stays zero. `vi.restoreAllMocks()` undoes
 * it.
 */
export function stubTrackDragLayout(options: {
  readonly axis: "x" | "y";
  readonly zoneSelector: string;
  readonly size: number;
  readonly zoneLength: number;
  /** The track ids in display order, read at each measurement. */
  order(): readonly string[];
}): void {
  const box = (start: number, length: number, cross: number): DOMRect => {
    const [left, top, width, height] =
      options.axis === "y" ? [0, start, cross, length] : [start, 0, length, cross];
    return new DOMRect(left, top, width, height);
  };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    const id = (this as HTMLElement).dataset?.trackDrag;
    if (id !== undefined) {
      return box(options.order().indexOf(id) * options.size, options.size, 100);
    }
    if (this.matches(options.zoneSelector)) return box(0, options.zoneLength, 100);
    return new DOMRect(0, 0, 0, 0);
  });
}

/** A pointer event jsdom will carry `clientX`/`clientY`/`button` on. */
function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
}

/**
 * Press on `handle`, move to `to` (past the drag threshold), run `beforeRelease`
 * while still holding, then let go there.
 */
export function dragTrackHandle(
  handle: Element,
  to: { x: number; y: number },
  beforeRelease?: () => void,
): void {
  fireEvent(handle, pointer("pointerdown", 1, 1));
  flush();
  fireEvent(window, pointer("pointermove", to.x, to.y));
  flush();
  beforeRelease?.();
  fireEvent(window, pointer("pointerup", to.x, to.y));
  flush();
}
