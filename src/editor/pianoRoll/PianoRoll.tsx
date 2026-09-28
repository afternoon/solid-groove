import { For, type JSX, Show } from "@solidjs/web";
import { createEffect, createMemo, createSignal } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../../analytics/analytics";
import { bucketOf } from "../../analytics/buckets";
import type {
  Gesture,
  GestureOptions,
  RawCommandInput,
  TransactionResult,
} from "../../commands";
import { noteEventsOf, removeNotes } from "../../commands";
import type { Clip, NoteEvent, Project } from "../../domain/entities";
import { createFactoryContext } from "../../domain/factories";
import type { EventId } from "../../domain/ids";
import { detectPlatform } from "../../shortcuts/keys";
import { pitchOf } from "./edits";
import Gutter from "./Gutter";
import { ROW_HEIGHT, stepWidth, ticksToSteps } from "./layout";
import NoteLayer from "./NoteLayer";
import Ruler from "./Ruler";
import { focusRow, type PianoRollRow, visibleRows } from "./rows";
import Toolbar from "./Toolbar";
import { useRollPointer } from "./useRollPointer";
import { useRollViewport } from "./useRollViewport";

/** Mints the ids of notes the roll creates. Module singleton, as elsewhere. */
const factoryContext = createFactoryContext();

export interface PianoRollProps {
  readonly clip: Clip;
  /** The project, for the song's key and for commands that read it. */
  readonly project: Project;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  /** Opens a continuous gesture so a drag is one undo entry. */
  beginGesture(options?: GestureOptions): Gesture | undefined;
  /** A read-only mirror of the selection, for the Transform panel. */
  onSelectionChange?(ids: readonly EventId[]): void;
  /** The playhead, in ticks, while the transport runs. */
  readonly playheadTicks?: number;
  readonly playing?: boolean;
  onTogglePlay?(): void;
  /** Plays one pitch on the clip's instrument. */
  audition?(pitch: number, velocity: number): void;
  /** Defaults to the application's singleton; injectable for tests. */
  readonly analytics?: Analytics;
}

/** Two row lists that would draw the same gutter. */
function sameRows(a: readonly PianoRollRow[], b: readonly PianoRollRow[]): boolean {
  return (
    a.length === b.length &&
    a.every((row, index) => row.pitch === b[index].pitch && row.off === b[index].off)
  );
}

/**
 * The piano roll (ARR-010): a step grid of the clip's notes under a ruler,
 * with a note-name gutter down its left edge, in the song's key.
 *
 * It owns what is only a view: the selection, the insert marker, zoom and the
 * preview switch. Every change to the clip goes through the command layer,
 * never a direct mutation. The pure models it draws from — `rows`, `layout`
 * and `edits` — are where the maths lives and is tested.
 */
export default function PianoRoll(props: PianoRollProps): JSX.Element {
  const analytics = () => props.analytics ?? defaultAnalytics;
  const [selection, setSelection] = createSignal<ReadonlySet<EventId>>(new Set());
  const [marker, setMarker] = createSignal(0);
  const [preview, setPreview] = createSignal(true);

  const notes = createMemo(() => noteEventsOf(props.clip) ?? []);
  // A new list only when the gutter would change, so an edit that moves a
  // note within its row does not rebuild every row.
  const rows = createMemo<readonly PianoRollRow[]>((previous) => {
    const next = visibleRows(props.project.song.key, notes().map(pitchOf));
    return previous && sameRows(previous, next) ? previous : next;
  });
  // A selection can outlive its notes (an undo, a remote edit); only the
  // notes still in the clip count.
  const selected = createMemo<ReadonlySet<EventId>>(() => {
    const present = new Set(notes().map((note) => note.id));
    return new Set([...selection()].filter((id) => present.has(id)));
  });
  const steps = () => Math.ceil(ticksToSteps(props.clip.lengthTicks));
  const viewport = useRollViewport({
    focusRow: () => focusRow(rows(), notes().map(pitchOf)),
  });
  const zoom = viewport.zoom;
  const width = () => stepWidth(zoom());
  let grid: HTMLDivElement | undefined;
  const pointer = useRollPointer({
    clip: () => props.clip,
    notes,
    rows,
    zoom,
    selected,
    setSelection,
    setMarker,
    grid: () => grid,
    scroller: viewport.scrollElement,
    dispatch: (commands) => props.dispatch(commands),
    beginGesture: (options) => props.beginGesture(options),
    audition: (pitch, velocity) => audition(pitch, velocity),
    onEdited: (count) => {
      analytics().logFeatureFirstUse("piano_roll");
      logClipEdited(count);
    },
    factory: factoryContext,
    platform: detectPlatform(),
  });

  createEffect(
    () => [...selected()],
    (ids) => {
      props.onSelectionChange?.(ids);
    },
  );

  function logClipEdited(count: number): void {
    analytics().log("clip_edited", {
      editor: "piano_roll",
      event_count_bucket: bucketOf("event_count", count),
    });
  }

  function audition(pitch: number, velocity = 0.8): void {
    if (!preview()) return;
    props.audition?.(pitch, velocity);
    analytics().logFeatureFirstUse("note_audition");
  }

  function deleteNotes(ids: readonly EventId[]): void {
    if (ids.length === 0) return;
    analytics().logFeatureFirstUse("piano_roll");
    props.dispatch(removeNotes(props.clip.id, ids));
    logClipEdited(ids.length);
    setSelection((current) => new Set([...current].filter((id) => !ids.includes(id))));
  }

  function deleteNote(note: NoteEvent): void {
    deleteNotes([note.id]);
  }

  const playheadLeft = createMemo<number | null>(() => {
    const ticks = props.playheadTicks;
    if (!props.playing || ticks === undefined || ticks >= props.clip.lengthTicks) {
      return null;
    }
    return ticksToSteps(ticks) * width();
  });

  return (
    <section
      class="piano-roll"
      aria-label={`Piano roll: ${props.clip.name}`}
      style={{ "--pr-step": `${width()}px` }}
    >
      <Toolbar
        selectionCount={selected().size}
        onSelectAll={() => setSelection(new Set(notes().map((note) => note.id)))}
        onDelete={() => deleteNotes([...selected()])}
        preview={preview()}
        onTogglePreview={() => setPreview((on) => !on)}
        zoom={zoom()}
        onZoomIn={viewport.zoomIn}
        onZoomOut={viewport.zoomOut}
        playing={props.playing ?? false}
        onTogglePlay={() => props.onTogglePlay?.()}
      />
      <div class="pr-frame">
        <div class="pr-ruler-row">
          <div class="pr-corner" />
          <div
            class="pr-ruler-viewport"
            ref={viewport.ruler}
            onScroll={viewport.onRulerScroll}
          >
            <Ruler
              steps={steps()}
              stepWidth={width()}
              marker={marker()}
              onSetMarker={setMarker}
            />
          </div>
        </div>
        <div
          class="pr-scroller"
          ref={viewport.scroller}
          onScroll={viewport.onScrollerScroll}
        >
          <div class="pr-canvas">
            <Gutter rows={rows()} onAudition={(pitch) => audition(pitch)} />
            <div
              class="pr-grid"
              ref={grid}
              style={{
                width: `${steps() * width()}px`,
                height: `${rows().length * ROW_HEIGHT}px`,
              }}
              onPointerDown={(event) => pointer.pressEmpty(event)}
              onPointerMove={(event) => pointer.move(event)}
              onPointerUp={() => pointer.release()}
              onPointerCancel={() => pointer.cancel()}
            >
              <For each={rows()}>
                {(row) => (
                  <div
                    class={["pr-row", { black: row.black, off: row.off }]}
                    aria-hidden="true"
                  />
                )}
              </For>
              <NoteLayer
                notes={notes()}
                rows={rows()}
                zoom={zoom()}
                selected={selected()}
                onNotePointerDown={(note, event) => pointer.pressNote(note, event)}
                onNoteDoubleClick={deleteNote}
              />
              <div
                class="pr-marker-line"
                style={{ left: `${marker() * width()}px` }}
                aria-hidden="true"
              />
              <Show when={playheadLeft() !== null}>
                <div
                  class="pr-playhead"
                  style={{ left: `${playheadLeft()}px` }}
                  aria-hidden="true"
                />
              </Show>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
