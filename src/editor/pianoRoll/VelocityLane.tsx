import { For, type JSX } from "@solidjs/web";
import type { Gesture, GestureOptions } from "../../commands";
import { updateNotes } from "../../commands";
import type { NoteEvent } from "../../domain/entities";
import type { ClipId, EventId } from "../../domain/ids";
import { pitchOf, velocityUpdates } from "./edits";
import { stepWidth, ticksToSteps } from "./layout";
import "./VelocityLane.css";

/** The quietest a stalk drag sets: a note at zero would vanish from the lane. */
const MIN_VELOCITY = 0.05;

export interface VelocityLaneProps {
  readonly clipId: ClipId;
  readonly notes: readonly NoteEvent[];
  readonly selected: ReadonlySet<EventId>;
  readonly steps: number;
  readonly zoom: number;
  beginGesture(options?: GestureOptions): Gesture | undefined;
  /** Called once a drag commits, with how many notes it changed. */
  onEdited(count: number): void;
  audition(pitch: number, velocity: number): void;
  /** The lane's scrolling strip, kept in step with the grid by the roll. */
  viewport(element: HTMLElement): void;
}

interface Drag {
  readonly gesture: Gesture;
  readonly anchor: NoteEvent;
  readonly notes: readonly NoteEvent[];
  readonly height: number;
  target: number;
}

/** The corner's readout: one note's velocity out of 127, or "Mixed". */
function readout(notes: readonly NoteEvent[]): string {
  if (notes.length === 0) return "";
  if (notes.length > 1) return "Mixed";
  return `${Math.round(notes[0].velocity * 127)}`;
}

/**
 * The velocity lane under the roll (ARR-010): one hairline stalk per note,
 * as tall as its velocity. Dragging a stalk sets that note's velocity, or
 * moves every selected note's together when that note is selected; the drag
 * is one gesture, so one undo entry. Velocity shows here and nowhere else:
 * every note in the grid is the same white.
 */
export default function VelocityLane(props: VelocityLaneProps): JSX.Element {
  let drag: Drag | null = null;
  let strip: HTMLDivElement | undefined;
  const width = () => stepWidth(props.zoom);
  const selectedNotes = () => props.notes.filter((note) => props.selected.has(note.id));

  function velocityAt(event: PointerEvent, height: number): number {
    const top = strip?.getBoundingClientRect().top ?? 0;
    const value = 1 - (event.clientY - top) / Math.max(1, height);
    return Math.min(1, Math.max(MIN_VELOCITY, value));
  }

  function press(event: PointerEvent): void {
    if ((event.button ?? 0) !== 0 || !strip) return;
    const left = strip.getBoundingClientRect().left;
    const step = Math.floor((event.clientX - left) / width());
    const under = props.notes.filter((note) => {
      const start = ticksToSteps(note.startTicks);
      return step >= Math.floor(start) && step < start + ticksToSteps(note.durationTicks);
    });
    if (under.length === 0) return;
    const height = strip.clientHeight || 1;
    const target = velocityAt(event, height);
    const anchor =
      under.find((note) => props.selected.has(note.id)) ??
      under.reduce((a, b) =>
        Math.abs(b.velocity - target) < Math.abs(a.velocity - target) ? b : a,
      );
    const gesture = props.beginGesture({ summary: "Set velocity" });
    if (!gesture) return;
    const notes = props.selected.has(anchor.id) ? selectedNotes() : [anchor];
    drag = { gesture, anchor, notes, height, target };
    strip.setPointerCapture?.(event.pointerId);
    update(event);
  }

  function update(event: PointerEvent): void {
    if (!drag) return;
    drag.target = velocityAt(event, drag.height);
    drag.gesture.apply(
      updateNotes(props.clipId, velocityUpdates(drag.notes, drag.anchor, drag.target)),
    );
  }

  function release(): void {
    const current = drag;
    drag = null;
    if (!current) return;
    if (current.gesture.commit()) props.onEdited(current.notes.length);
    props.audition(pitchOf(current.anchor), current.target);
  }

  return (
    <div class="pr-velocity">
      <div class="pr-velocity-corner">
        <span class="pr-velocity-label">Velocity</span>
        <b class="pr-velocity-value">{readout(selectedNotes())}</b>
      </div>
      <div class="pr-velocity-viewport" ref={props.viewport}>
        <div
          class="pr-velocity-strip"
          ref={strip}
          style={{ width: `${props.steps * width()}px` }}
          onPointerDown={press}
          onPointerMove={update}
          onPointerUp={release}
          onPointerCancel={() => {
            drag?.gesture.cancel();
            drag = null;
          }}
        >
          <For each={props.notes}>
            {(note) => (
              <i
                class={["pr-stalk", { selected: props.selected.has(note.id) }]}
                style={{
                  left: `${ticksToSteps(note.startTicks) * width()}px`,
                  height: `${note.velocity * 100}%`,
                }}
                aria-hidden="true"
              >
                <b
                  style={{
                    width: `${Math.max(6, Math.min(20, ticksToSteps(note.durationTicks) * width() - 6))}px`,
                  }}
                />
              </i>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
