import { For, type JSX, Show } from "@solidjs/web";
import { PITCH_CLASS_NAMES, type PitchClass, type ScaleMode } from "./pitchClass";

export interface PianoRollToolbarProps {
  /** How many notes are selected; 0 disables the destructive actions. */
  readonly selectionCount: number;
  duplicateSelection(): void;
  deleteSelection(): void;
  /** The in-key guide's view-only state, owned by the roll (never persisted). */
  readonly keyGuideEnabled: boolean;
  setKeyGuideEnabled(enabled: boolean): void;
  readonly keyRoot: PitchClass;
  setKeyRoot(root: PitchClass): void;
  readonly keyMode: ScaleMode;
  setKeyMode(mode: ScaleMode): void;
  zoomIn(): void;
  zoomOut(): void;
}

/**
 * The piano roll's toolbar: duplicate/delete for the current selection, a live
 * selection count, the CLP-03 optional in-key guide controls, and zoom.
 *
 * Purely presentational — it owns no state and dispatches no command. The roll
 * passes its selection and view state down and receives the operations back, so
 * every mutation still runs through the roll's command-layer dispatch.
 */
export default function PianoRollToolbar(props: PianoRollToolbarProps): JSX.Element {
  return (
    <div class="piano-roll-toolbar">
      <button
        type="button"
        class="pr-tool"
        onClick={() => props.duplicateSelection()}
        disabled={props.selectionCount === 0}
        aria-label="Duplicate selected notes"
        title="Duplicate (Ctrl/Cmd+D)"
      >
        Duplicate
      </button>
      <button
        type="button"
        class="pr-tool"
        onClick={() => props.deleteSelection()}
        disabled={props.selectionCount === 0}
        aria-label="Delete selected notes"
        title="Delete (Del)"
      >
        Delete
      </button>
      <span class="pr-selection-count" aria-live="polite">
        {props.selectionCount} selected
      </span>
      <label class="pr-key-guide">
        <input
          type="checkbox"
          checked={props.keyGuideEnabled}
          onChange={(event) => props.setKeyGuideEnabled(event.currentTarget.checked)}
        />
        <span>In-key guide</span>
      </label>
      <Show when={props.keyGuideEnabled}>
        <label class="visually-hidden" for="pr-key-root">
          Key root
        </label>
        <select
          id="pr-key-root"
          class="pr-key-select"
          value={String(props.keyRoot)}
          onChange={(event) =>
            props.setKeyRoot(Number(event.currentTarget.value) as PitchClass)
          }
        >
          <For each={PITCH_CLASS_NAMES}>
            {(name, index) => <option value={String(index())}>{name}</option>}
          </For>
        </select>
        <label class="visually-hidden" for="pr-key-mode">
          Key mode
        </label>
        <select
          id="pr-key-mode"
          class="pr-key-select"
          value={props.keyMode}
          onChange={(event) => props.setKeyMode(event.currentTarget.value as ScaleMode)}
        >
          <option value="major">Major</option>
          <option value="minor">Minor</option>
        </select>
      </Show>
      <span class="pr-zoom">
        <button
          type="button"
          class="pr-tool"
          onClick={() => props.zoomOut()}
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          class="pr-tool"
          onClick={() => props.zoomIn()}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
      </span>
    </div>
  );
}
