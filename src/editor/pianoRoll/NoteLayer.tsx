import { For, type JSX, Show } from "@solidjs/web";
import type { NoteEvent } from "../../domain/entities";
import type { EventId } from "../../domain/ids";
import { pitchOf } from "./edits";
import { noteBox, ticksToSteps } from "./layout";
import { type PianoRollRow, pitchName, rowIndexOf } from "./rows";
import "./grid.css";

export interface NoteLayerProps {
  readonly notes: readonly NoteEvent[];
  readonly rows: readonly PianoRollRow[];
  readonly zoom: number;
  readonly selected: ReadonlySet<EventId>;
  onNotePointerDown(note: NoteEvent, event: PointerEvent): void;
  onNoteDoubleClick(note: NoteEvent): void;
}

/** A step count, with as few decimals as an off-grid note needs. */
function steps(ticks: number): number {
  return Math.round(ticksToSteps(ticks) * 100) / 100;
}

/**
 * A note's accessible name: "C2, step 1, 2 steps". Steps count from 1, as
 * the ruler does.
 */
export function noteLabel(note: NoteEvent): string {
  const length = steps(note.durationTicks);
  const unit = length === 1 ? "step" : "steps";
  return `${pitchName(pitchOf(note))}, step ${steps(note.startTicks) + 1}, ${length} ${unit}`;
}

/**
 * The clip's notes over the grid, as the options of one listbox: each named
 * by pitch, step and length, and selected or not. Every note is the same
 * white; a selected one gets a black inner frame and a white ring. Velocity
 * does not show here — it reads in the velocity lane.
 *
 * Presentational: presses and double-clicks go to the roll, which owns the
 * selection and every edit.
 */
export default function NoteLayer(props: NoteLayerProps): JSX.Element {
  return (
    <div class="pr-notes" role="listbox" aria-label="Notes" aria-multiselectable="true">
      <For each={props.notes}>
        {(note) => {
          const row = () => rowIndexOf(props.rows, pitchOf(note));
          return (
            <Show when={row() >= 0}>
              {/* biome-ignore lint/a11y/useFocusableInteractive: notes are chosen by pointer and by the roll's registered shortcuts (select all, arrows, delete), not by a roving focus through every note */}
              <div
                role="option"
                class={["pr-note", { selected: props.selected.has(note.id) }]}
                aria-selected={props.selected.has(note.id) ? "true" : "false"}
                aria-label={noteLabel(note)}
                style={boxStyle(note, row(), props.zoom)}
                onPointerDown={(event) => props.onNotePointerDown(note, event)}
                onDblClick={() => props.onNoteDoubleClick(note)}
              />
            </Show>
          );
        }}
      </For>
    </div>
  );
}

function boxStyle(note: NoteEvent, row: number, zoom: number): JSX.CSSProperties {
  const box = noteBox(note.startTicks, note.durationTicks, row, zoom);
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  };
}
