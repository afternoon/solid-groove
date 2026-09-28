import { For, type JSX, Show } from "@solidjs/web";
import { type PianoRollRow, pitchName } from "./rows";

export interface GutterProps {
  readonly rows: readonly PianoRollRow[];
  /** Plays a row's pitch when its name is pressed. */
  onAudition(pitch: number): void;
}

/**
 * The note-name gutter down the roll's left edge: one button per row, named
 * by its pitch, white for a white key and black for a black one, and tagged
 * `Off` when the row is shown only because it holds a note outside the key.
 *
 * Pressing a name plays it. The buttons are out of the tab order: there are
 * dozens of them, and hearing a pitch is a pointer convenience that no
 * keyboard path depends on.
 */
export default function Gutter(props: GutterProps): JSX.Element {
  return (
    <fieldset class="pr-gutter" aria-label="Pitches">
      <For each={props.rows}>
        {(row) => (
          <button
            type="button"
            tabindex="-1"
            class={["pr-key", { black: row.black, off: row.off }]}
            aria-label={row.off ? `${pitchName(row.pitch)} Off` : pitchName(row.pitch)}
            onPointerDown={() => props.onAudition(row.pitch)}
          >
            <span>{pitchName(row.pitch)}</span>
            <Show when={row.off}>
              <em class="pr-key-off" aria-hidden="true">
                Off
              </em>
            </Show>
          </button>
        )}
      </For>
    </fieldset>
  );
}
