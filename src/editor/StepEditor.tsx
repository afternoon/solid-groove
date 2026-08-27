import { For, type JSX, Show } from "@solidjs/web";
import { type Accessor, createMemo, createSignal } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { Gesture, GestureOptions, RawCommandInput } from "../commands";
import { removeNotes, updateClip, updateNote } from "../commands";
import type { Clip, Instrument, NoteEvent, NoteTrigger } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import type { EventId } from "../domain/ids";
import { NOTE_VELOCITY } from "../domain/parameters";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from "../domain/time";
import {
  barCount,
  isBarStart,
  isBeatStart,
  lanesFor,
  MAX_BARS,
  MIN_BARS,
  noteAt,
  type StepLane,
  stepCount,
  stepStartTicks,
} from "./stepEditorModel";
import { createStroke } from "./stepStroke";
import "./StepEditor.css";
import { ariaBool } from "../shared/aria";

/**
 * Mints note-event IDs for notes the editor paints. A module singleton, not
 * per-render, so two strokes in the same session never collide.
 */
const factoryContext = createFactoryContext();

export interface StepEditorProps {
  readonly clip: Clip;
  /** The owning track's instrument, used to derive the lanes (CLP-02). */
  readonly instrument: Instrument | null;
  /** Single, immediately-committed edits (velocity, resize). */
  dispatch(commands: RawCommandInput | readonly RawCommandInput[]): unknown;
  /** Opens a paint/erase stroke that commits as one history entry. */
  beginGesture(options?: GestureOptions): Gesture | undefined;
  /** The step the playhead is over while playing, or null. */
  readonly playbackStep?: () => number | null;
  /**
   * Controlled selection: the set of selected note ids and its setter. Lifted
   * to the parent so the editor's `edit.delete` shortcut (owned by
   * `EditorView`) can act on the same selection the grid renders. Optional —
   * when omitted the editor manages selection internally.
   */
  readonly selectedIds?: Accessor<readonly EventId[]>;
  readonly setSelectedIds?: (next: readonly EventId[]) => void;
  /** Defaults to the application singleton; injectable for tests. */
  readonly analytics?: Analytics;
}

/**
 * The CLP-02 step editor: a 1-8 bar, 16th-note grid for sampler and
 * drum-machine clips. Replaces the `FND-009` slice's minimal 16-step
 * `StepGrid`.
 *
 * Every project mutation goes through the shared command layer (PRD section
 * 9.6): a paint or erase drag is one `CommandHistory` gesture — every step
 * applies immediately so audio stays live, but the whole stroke lands as a
 * single history entry and revision (CLP-02 "undo groups a single drag
 * gesture"). Velocity and clip-length edits are single committed commands.
 */
export default function StepEditor(props: StepEditorProps): JSX.Element {
  const analytics = () => props.analytics ?? defaultAnalytics;
  const lanes = createMemo(() => lanesFor(props.instrument));
  const steps = createMemo(() =>
    Array.from({ length: stepCount(props.clip) }, (_, index) => index),
  );
  const bars = createMemo(() => barCount(props.clip));

  // Selection is UI-only state (PRD 9.2) — it points at notes by their stable
  // event id and never mutates the project. Controlled by the parent when it
  // supplies the accessor/setter (so the `edit.delete` shortcut shares it),
  // otherwise managed here.
  const internalSelection = createSignal<readonly EventId[]>([]);
  const selectedIds = (): readonly EventId[] =>
    props.selectedIds?.() ?? internalSelection[0]();
  const setSelectedIds = (
    next: readonly EventId[] | ((prev: readonly EventId[]) => readonly EventId[]),
  ): void => {
    const value = typeof next === "function" ? next(selectedIds()) : next;
    if (props.setSelectedIds) {
      props.setSelectedIds(value);
    } else {
      internalSelection[1](value);
    }
  };
  const isSelected = (id: EventId): boolean => selectedIds().includes(id);
  const selectOnly = (id: EventId): void => setSelectedIds([id]);
  const deselect = (id: EventId): void =>
    setSelectedIds((ids) => ids.filter((existing) => existing !== id));
  const toggleSelected = (id: EventId): void =>
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id],
    );

  // The single selected note, if exactly one is selected — the target of the
  // velocity control below.
  const selectedNote = createMemo<NoteEvent | null>(() => {
    const ids = selectedIds();
    if (ids.length !== 1) return null;
    const [id] = ids;
    return (
      (props.clip.content.kind === "notes"
        ? props.clip.content.events.find((event) => event.id === id)
        : undefined) ?? null
    );
  });

  function noteForCell(lane: StepLane, step: number): NoteEvent | undefined {
    return noteAt(props.clip, lane, step);
  }

  function newNote(lane: StepLane, step: number): NoteEvent {
    return {
      id: factoryContext.ids("event"),
      trigger: lane.trigger satisfies NoteTrigger,
      startTicks: stepStartTicks(step) as NoteEvent["startTicks"],
      durationTicks: TICKS_PER_SIXTEENTH as NoteEvent["durationTicks"],
      velocity: NOTE_VELOCITY.defaultValue as NoteEvent["velocity"],
      probability: null,
    };
  }

  // The active paint/erase stroke, if a pointer is down. Held outside Solid's
  // reactive graph: it is imperative gesture bookkeeping, not rendered state.
  // The machine itself lives in `stepStroke.ts`; this component supplies the
  // seam it reads the clip, the gesture kernel, and the selection through.
  const stroke = createStroke({
    get clipId() {
      return props.clip.id;
    },
    beginGesture: (options) => props.beginGesture(options),
    noteAt: noteForCell,
    newNote,
    analytics,
    onNoteAdded: (id) => selectOnly(id),
    onNoteRemoved: (id) => deselect(id),
  });

  // --- Pointer handling ---------------------------------------------------
  //
  // Painting captures the pointer on the cell it starts on, so the drag keeps
  // delivering `pointerenter`/`pointermove` even as it leaves that element, and
  // `preventDefault` on pointerdown keeps a drag from starting a text selection
  // (CLP-02 "without triggering accidental text selection").

  function onCellPointerDown(event: PointerEvent, lane: StepLane, step: number): void {
    // Only the primary button paints; a middle/right press is left alone. A
    // synthetic event with no `button` (jsdom) counts as primary.
    if (event.button > 0) return;
    // Shift-click selects an existing note instead of erasing it.
    const existing = noteForCell(lane, step);
    if (event.shiftKey && existing) {
      event.preventDefault();
      toggleSelected(existing.id);
      return;
    }
    event.preventDefault();
    // No `batch` wrapper any more: Solid 2 batches every write to the end of
    // the microtask, so the step's project write and the selection write it
    // triggers still land together — over a wider span than the old explicit
    // batch, which only covered this one call.
    stroke.begin(lane, step);
  }

  function onCellPointerEnter(lane: StepLane, step: number): void {
    if (!stroke.active) return;
    stroke.paint(lane, step);
  }

  function velocityFor(note: NoteEvent): number {
    return note.velocity;
  }

  function applyVelocity(note: NoteEvent, value: number): void {
    if (!Number.isFinite(value)) return;
    props.dispatch(
      updateNote(props.clip.id, note.id, {
        velocity: value as NoteEvent["velocity"],
      }),
    );
  }

  function resizeToBars(nextBars: number): void {
    const clamped = Math.min(MAX_BARS, Math.max(MIN_BARS, Math.round(nextBars)));
    const lengthTicks = clamped * TICKS_PER_BAR;
    if (lengthTicks === props.clip.lengthTicks) return;
    props.dispatch(
      updateClip(props.clip.id, {
        lengthTicks: lengthTicks as Clip["lengthTicks"],
      }),
    );
  }

  const currentPlaybackStep = () => props.playbackStep?.() ?? null;

  return (
    <section
      class="step-editor"
      aria-label="Step editor"
      // Ending or cancelling a stroke anywhere the pointer is released keeps a
      // drag that leaves the grid from committing a half-open gesture.
      onPointerUp={() => stroke.end()}
      onPointerLeave={() => stroke.end()}
    >
      <div class="step-editor-toolbar">
        <label class="step-editor-length">
          <span class="step-editor-length-label">Bars</span>
          <select
            class="step-editor-length-select"
            value={bars()}
            onChange={(event) => resizeToBars(Number(event.currentTarget.value))}
          >
            <For
              each={Array.from(
                { length: MAX_BARS - MIN_BARS + 1 },
                (_, index) => MIN_BARS + index,
              )}
            >
              {(count) => <option value={count}>{count}</option>}
            </For>
          </select>
        </label>
        <Show when={selectedNote()}>
          {(note) => (
            <label class="step-editor-velocity">
              <span class="step-editor-velocity-label">Velocity</span>
              <input
                class="step-editor-velocity-input"
                type="range"
                min={NOTE_VELOCITY.min}
                max={NOTE_VELOCITY.max}
                step={0.01}
                value={velocityFor(note())}
                onInput={(event) =>
                  applyVelocity(note(), event.currentTarget.valueAsNumber)
                }
              />
              <span class="step-editor-velocity-value" aria-hidden="true">
                {Math.round(velocityFor(note()) * 127)}
              </span>
            </label>
          )}
        </Show>
      </div>
      <div
        class="step-editor-grid"
        style={{ "--step-count": String(stepCount(props.clip)) }}
      >
        <For each={lanes()}>
          {(lane) => (
            <fieldset class="step-lane" aria-label={`Lane ${lane.name}`}>
              <div class="step-lane-name" title={lane.name}>
                {lane.name}
              </div>
              <div class="step-lane-cells">
                <For each={steps()}>
                  {(step) => {
                    const note = () => noteForCell(lane, step);
                    const active = () => note() !== undefined;
                    const selected = () => {
                      const current = note();
                      return current ? isSelected(current.id) : false;
                    };
                    const playing = () => currentPlaybackStep() === step;
                    return (
                      <button
                        type="button"
                        class={[
                          "step-cell",
                          {
                            active: active(),
                            selected: selected(),
                            playing: playing(),
                            "bar-start": isBarStart(step),
                            "beat-start": isBeatStart(step),
                          },
                        ]}
                        style={
                          active()
                            ? {
                                "--velocity": String(note()?.velocity ?? 1),
                              }
                            : undefined
                        }
                        aria-pressed={ariaBool(active())}
                        aria-label={`${lane.name}, step ${step + 1}${
                          active() ? ", on" : ", off"
                        }`}
                        onPointerDown={(event) => onCellPointerDown(event, lane, step)}
                        onPointerEnter={() => onCellPointerEnter(lane, step)}
                      />
                    );
                  }}
                </For>
              </div>
            </fieldset>
          )}
        </For>
      </div>
    </section>
  );
}

/**
 * Removes the given notes as one committed command, and clears them from a
 * selection. Exposed for the editor's `edit.delete` shortcut wiring.
 */
export function deleteSelectedNotes(
  clip: Clip,
  ids: readonly EventId[],
  dispatch: (commands: RawCommandInput | readonly RawCommandInput[]) => unknown,
): void {
  if (ids.length === 0) return;
  const present = new Set(
    clip.content.kind === "notes" ? clip.content.events.map((event) => event.id) : [],
  );
  const removable = ids.filter((id) => present.has(id));
  if (removable.length === 0) return;
  dispatch(removeNotes(clip.id, removable));
}
