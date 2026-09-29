import { For, type JSX, Show } from "@solidjs/web";
import { type Accessor, createMemo, createSignal } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { Gesture, GestureOptions, RawCommandInput } from "../commands";
import { createControlGesture, removeNotes, updateClip, updateNote } from "../commands";
import type { Clip, Instrument, NoteEvent, NoteTrigger } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import type { EventId, PadId } from "../domain/ids";
import { NOTE_VELOCITY } from "../domain/parameters";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from "../domain/time";
import FillSlider from "../instrument/FillSlider";
import { clampZoom, stepWidth, ZOOM_FACTOR } from "./pianoRoll/layout";
import Ruler from "./pianoRoll/Ruler";
import Toolbar from "./pianoRoll/Toolbar";
import {
  barCount,
  barOptions,
  isBarStart,
  isShadedBeat,
  lanesFor,
  MAX_BARS,
  MIN_BARS,
  noteAt,
  noteEventsOf,
  type StepLane,
  selectedLane,
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
  /** Whether the transport runs, and how the toolbar's Play toggles it. */
  readonly playing?: boolean;
  onTogglePlay?(): void;
  /** Whether the clip's track is soloed, and how the toolbar's Solo toggles it (#657). */
  readonly soloed?: boolean;
  onToggleSolo?(): void;
  /**
   * Controlled selection: the set of selected note ids and its setter. Lifted
   * to the parent so the editor's `edit.delete` shortcut (owned by
   * `EditorView`) can act on the same selection the grid renders. Optional —
   * when omitted the editor manages selection internally.
   */
  readonly selectedIds?: Accessor<readonly EventId[]>;
  readonly setSelectedIds?: (next: readonly EventId[]) => void;
  /**
   * The selected row's pad, when the host owns it (#643): the drum machine
   * panel's selected pad is the same selection. Held here when omitted.
   */
  readonly selectedPadId?: PadId | null;
  onSelectPad?(padId: PadId): void;
  /** Plays one pad, as its row is picked. */
  auditionPad?(padId: PadId): void;
  /** Defaults to the application singleton; injectable for tests. */
  readonly analytics?: Analytics;
}

/**
 * The CLP-02 step editor: a 1-32 bar, 16th-note grid for sampler and
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

  // The selected row (#643): the target of the Generate panel and the rows
  // the velocity lane shows. On a drum machine it is the selected pad, shared
  // with the drum machine panel; painting a cell never moves it.
  const [ownRow, setOwnRow] = createSignal<string | null>(null);
  const row = createMemo(() =>
    selectedLane(
      lanes(),
      props.selectedPadId !== undefined ? props.selectedPadId : ownRow(),
    ),
  );
  function selectRow(lane: StepLane): void {
    setOwnRow(lane.key);
    if (lane.trigger.kind !== "pad") return;
    props.onSelectPad?.(lane.trigger.padId);
    audition(lane);
  }

  // What is only a view, as in the piano roll (ARR-010): preview and zoom.
  const [preview, setPreview] = createSignal(true);
  const [zoom, setZoom] = createSignal(1);
  const width = () => stepWidth(zoom());
  /** Plays a row's pad, while Preview sound is on. */
  function audition(lane: StepLane): void {
    if (preview() && lane.trigger.kind === "pad") props.auditionPad?.(lane.trigger.padId);
  }
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
    audition(lane);
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

  /**
   * The selected step's velocity, as one gesture per drag (#255). Dispatching
   * a `note.update` straight from `input` made every pointer sample its own
   * transaction — dozens of revisions, dozens of autosaves, and one undo press
   * per sample to get back. The control gesture applies each step live inside
   * a single open gesture and commits it once on release.
   */
  const velocityControl = createControlGesture({
    beginGesture: (options) => props.beginGesture(options),
    dispatch: (commands) => {
      props.dispatch(commands);
      return undefined;
    },
    summary: () => "Set velocity",
    command: (value) =>
      updateNote(props.clip.id, selectedNote()?.id as EventId, {
        velocity: value as NoteEvent["velocity"],
      }),
  });

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

  function deleteSelection(): void {
    deleteSelectedNotes(props.clip, selectedIds(), props.dispatch);
    setSelectedIds([]);
  }

  return (
    <section
      class="step-editor"
      aria-label="Step editor"
      // Ending or cancelling a stroke anywhere the pointer is released keeps a
      // drag that leaves the grid from committing a half-open gesture.
      onPointerUp={() => stroke.end()}
      onPointerLeave={() => stroke.end()}
    >
      <Toolbar
        leading={
          <>
            <label class="step-editor-length">
              <span class="step-editor-length-label">Bars</span>
              <select
                class="step-editor-length-select"
                value={bars()}
                onChange={(event) => resizeToBars(Number(event.currentTarget.value))}
              >
                <For each={barOptions(props.clip)}>
                  {(count) => <option value={count}>{count}</option>}
                </For>
              </select>
            </label>
            <Show when={selectedNote()}>
              {(note) => (
                <div class="step-editor-velocity">
                  <FillSlider
                    definition={NOTE_VELOCITY}
                    inputId="step-editor-velocity"
                    label="Velocity"
                    // The value already reads as a left-right axis, as the mixer's
                    // pan does, and the toolbar is a single row.
                    orientation="horizontal"
                    value={velocityFor(note())}
                    // MIDI velocity, which is what the readout always showed.
                    displayValue={String(Math.round(velocityFor(note()) * 127))}
                    onInput={(value) => velocityControl.input(value)}
                    onCommit={(value) => velocityControl.commit(value)}
                  />
                </div>
              )}
            </Show>
          </>
        }
        selectionCount={selectedIds().length}
        onSelectAll={() =>
          setSelectedIds(noteEventsOf(props.clip).map((note) => note.id))
        }
        onDelete={deleteSelection}
        preview={preview()}
        onTogglePreview={() => setPreview((on) => !on)}
        soloed={props.soloed ?? false}
        onToggleSolo={() => props.onToggleSolo?.()}
        zoom={zoom()}
        onZoomIn={() => setZoom((z) => clampZoom(z * ZOOM_FACTOR))}
        onZoomOut={() => setZoom((z) => clampZoom(z / ZOOM_FACTOR))}
        playing={props.playing ?? false}
        onTogglePlay={() => props.onTogglePlay?.()}
      />
      <div
        class="step-editor-grid"
        style={{
          "--step-count": String(stepCount(props.clip)),
          "--pr-step": `${width()}px`,
        }}
      >
        <div class="step-corner" />
        <Ruler steps={stepCount(props.clip)} stepWidth={width()} />
        {/* The row names, one button per pad: clicking one picks the row. */}
        <fieldset class="step-rows" aria-label="Rows">
          <For each={lanes()}>
            {(lane) => (
              <button
                type="button"
                class="step-row-name"
                title={lane.name}
                aria-pressed={ariaBool(row()?.key === lane.key)}
                onClick={() => selectRow(lane)}
              >
                {lane.name}
              </button>
            )}
          </For>
        </fieldset>
        <div class="step-lanes">
          <For each={lanes()}>
            {(lane) => (
              <fieldset
                class="step-lane"
                aria-label={`Lane ${lane.name}`}
                aria-current={row()?.key === lane.key ? "true" : undefined}
              >
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
                            shade: isShadedBeat(step),
                          },
                        ]}
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
              </fieldset>
            )}
          </For>
        </div>
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
