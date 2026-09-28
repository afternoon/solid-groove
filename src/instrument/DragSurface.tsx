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

export interface DragSurfaceProps<G> {
  /**
   * What the press picked up — the nearest handle, say — decided once when
   * the drag starts and handed back on every move.
   */
  grab(point: SurfacePoint): G;
  /** The commands that put the grabbed thing at `point`. */
  commands(point: SurfacePoint, grabbed: G): readonly RawCommandInput[];
  /** History summary for the drag, read when it opens. */
  summary(): string;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  beginGesture(options?: GestureOptions): Gesture | undefined;
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

  const pointAt = (element: HTMLElement, event: PointerEvent): SurfacePoint => {
    const box = element.getBoundingClientRect();
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return {
      x: box.width > 0 ? clamp((event.clientX - box.left) / box.width) : 0,
      y: box.height > 0 ? clamp(1 - (event.clientY - box.top) / box.height) : 0,
    };
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
        grabbed = props.grab(point);
        try {
          gesture = props.beginGesture({ summary: props.summary() });
        } catch {
          // Another gesture is open elsewhere; each move lands on its own.
          gesture = undefined;
        }
        move(props.commands(point, grabbed));
      }}
      onPointerMove={(event) => {
        if (grabbed === undefined) return;
        move(props.commands(pointAt(event.currentTarget, event), grabbed));
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {props.children}
    </div>
  );
}
