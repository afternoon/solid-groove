import type { JSX } from "@solidjs/web";
import { onCleanup } from "solid-js";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../commands";
import "./Faceplate.css";

/** A point on a surface: `x` left to right and `y` bottom to top, both 0..1. */
export interface SurfacePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * How far, in pixels, a `startOnMove` press may wander before it becomes a
 * drag. A hand that wobbles by a pixel or two while clicking is still clicking,
 * and must not switch a band on or open a history entry.
 */
export const DRAG_SLOP_PX = 3;

/** A surface's size on screen, in pixels. */
export interface SurfaceBox {
  readonly width: number;
  readonly height: number;
}

export interface DragSurfaceProps<G> {
  /**
   * What the press picked up — the nearest handle, say — decided once when
   * the drag starts and handed back on every move. `box` is the surface's size
   * in pixels, for a caller that measures distance on screen.
   */
  grab(point: SurfacePoint, box: SurfaceBox): G;
  /** The commands that put the grabbed thing at `point`. */
  commands(point: SurfacePoint, grabbed: G): readonly RawCommandInput[];
  /** History summary for the drag, read when it opens. */
  summary(): string;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  /**
   * When set, a press only grabs: nothing is written, and no history entry
   * opens, until the pointer actually moves. For a surface where a click
   * means "pick this", not "put it here" (the EQ's band handles). A move
   * within `DRAG_SLOP_PX` of the press is still a click.
   */
  readonly startOnMove?: boolean;
  /** Called once when a drag lands, for a panel's first-use analytics. */
  onCommit?(): void;
  /** Handles and markers drawn over the well, positioned by the caller. */
  readonly children?: JSX.Element;
}

/**
 * The part of a well that can be dragged (#447): a filter's point, an
 * envelope's handles, a sample's start and end. A press grabs one thing and the
 * whole drag commits as one history entry, even when a move writes two values
 * at once (cutoff and resonance). The faders and value fields beside every well
 * set the same parameters, so this surface is a pointer shortcut and is hidden
 * from assistive tech.
 */
export default function DragSurface<G>(props: DragSurfaceProps<G>): JSX.Element {
  let gesture: Gesture | undefined;
  let grabbed: G | undefined;
  let last: readonly RawCommandInput[] = [];
  /** Where a `startOnMove` press landed on screen, until it turns into a drag. */
  let pressed: { readonly x: number; readonly y: number } | undefined;

  const pointAt = (element: HTMLElement, event: PointerEvent): SurfacePoint => {
    const box = element.getBoundingClientRect();
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return {
      x: box.width > 0 ? clamp((event.clientX - box.left) / box.width) : 0,
      y: box.height > 0 ? clamp(1 - (event.clientY - box.top) / box.height) : 0,
    };
  };

  const open = () => {
    try {
      gesture = props.beginGesture({ summary: props.summary() });
    } catch {
      // Another gesture is open elsewhere; each move lands on its own.
      gesture = undefined;
    }
  };

  const move = (commands: readonly RawCommandInput[]) => {
    last = commands;
    if (gesture?.active) gesture.apply(commands);
    else props.dispatch(commands);
  };

  const end = () => {
    if (grabbed === undefined) return;
    if (gesture?.active) gesture.commit();
    grabbed = undefined;
    gesture = undefined;
    pressed = undefined;
    if (last.length > 0) props.onCommit?.();
    last = [];
  };

  // A drag the pointer never releases here still ends: a track switch can
  // unmount the well mid-drag, and an open gesture would lock every other
  // control out (see `FillSlider`'s commit on pointer up and cancel).
  onCleanup(end);

  return (
    <div
      class="drag-surface"
      aria-hidden="true"
      onPointerDown={(event) => {
        if (event.button > 0) return;
        event.preventDefault();
        const element = event.currentTarget;
        element.setPointerCapture?.(event.pointerId);
        const point = pointAt(element, event);
        const box = element.getBoundingClientRect();
        grabbed = props.grab(point, { width: box.width, height: box.height });
        if (props.startOnMove) {
          pressed = { x: event.clientX, y: event.clientY };
          return;
        }
        open();
        move(props.commands(point, grabbed));
      }}
      onPointerMove={(event) => {
        if (grabbed === undefined) return;
        if (pressed) {
          // A move that has not left the press by more than the slop is still a click.
          const distance = Math.hypot(
            event.clientX - pressed.x,
            event.clientY - pressed.y,
          );
          if (distance <= DRAG_SLOP_PX) return;
          pressed = undefined;
          open();
        }
        const point = pointAt(event.currentTarget, event);
        move(props.commands(point, grabbed));
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {props.children}
    </div>
  );
}
