import {
  HiSolidArrowPathRoundedSquare,
  HiSolidArrowUturnLeft,
  HiSolidArrowUturnRight,
  HiSolidMusicalNote,
  HiSolidPlay,
  HiSolidQuestionMarkCircle,
  HiSolidRectangleStack,
  HiSolidSquares2x2,
  HiSolidStop,
} from "solid-icons/hi";
import { type Accessor, Show } from "solid-js";
import { MAX_TEMPO_BPM, MIN_TEMPO_BPM } from "../audio/Transport";
import type { TimeSignature } from "../domain/entities";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import type { SaveStatus as SaveStatusValue } from "../persistence/autosave";
import type { shortcutLabel } from "../shortcuts";
import SaveStatus from "./SaveStatus";

export interface EditorHeaderProps {
  readonly projectName: string;
  readonly canUndo: boolean;
  readonly undoSummary: string | null;
  readonly canRedo: boolean;
  readonly redoSummary: string | null;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly isPlaying: Accessor<boolean>;
  readonly onTogglePlay: () => void;
  readonly loopEnabled: Accessor<boolean>;
  readonly onToggleLoop: () => void;
  readonly metronomeEnabled: Accessor<boolean>;
  readonly onToggleMetronome: () => void;
  readonly tempo: Accessor<number>;
  readonly onTempoChange: (value: number) => void;
  readonly timeSignature: Accessor<TimeSignature | null>;
  readonly playheadLabel: Accessor<string>;
  readonly libraryOpen: Accessor<boolean>;
  readonly onToggleLibrary: () => void;
  readonly onOpenGuide: () => void;
  readonly keyHint: (action: Parameters<typeof shortcutLabel>[0]) => string;
  readonly saveStatus: Accessor<SaveStatusValue | null>;
  readonly onRetrySave: () => void;
}

/**
 * The editor's top bar: back link, project name, transport controls, tempo,
 * time signature, playhead, the Library/shortcut-guide toggles, and the
 * `SaveStatus` group. Split out of `EditorView` (`REFACTOR-001`) purely to
 * shrink the parent's merge-clash surface — no behavior changed, so every
 * prop here mirrors the exact value/handler `EditorView` used to close over
 * directly.
 */
export default function EditorHeader(props: EditorHeaderProps) {
  return (
    <header class="editor-header">
      {/*
       * A plain anchor: Solid Router 2 has no `<A>` component. The router
       * intercepts in-app anchor clicks itself and gives them the same
       * `aria-current`/`data-active`/`data-pending` vocabulary `<A>` used to
       * apply, so client-side navigation is unchanged.
       */}
      <a
        class="back-to-projects"
        href="/dashboard"
        aria-label="Projects"
        title="Projects"
      >
        <HiSolidSquares2x2 size={18} />
      </a>
      {/* The project's name, chosen by the user (ADR 0002 decision 2). */}
      <h1 class={`project-name ${MASK_CONTENT}`}>{props.projectName}</h1>
      <div class="transport-controls">
        <button
          type="button"
          class="undo-button"
          disabled={!props.canUndo}
          aria-label={props.undoSummary ? `Undo ${props.undoSummary}` : "Undo"}
          title={`${props.undoSummary ?? "Undo"} (${props.keyHint("edit.undo")})`}
          onClick={() => props.onUndo()}
        >
          <HiSolidArrowUturnLeft size={18} />
        </button>
        <button
          type="button"
          class="redo-button"
          disabled={!props.canRedo}
          aria-label={props.redoSummary ? `Redo ${props.redoSummary}` : "Redo"}
          title={`${props.redoSummary ?? "Redo"} (${props.keyHint("edit.redo")})`}
          onClick={() => props.onRedo()}
        >
          <HiSolidArrowUturnRight size={18} />
        </button>
        <button
          type="button"
          class="transport-toggle"
          onClick={() => props.onTogglePlay()}
          aria-pressed={props.isPlaying() ? "true" : "false"}
          aria-label={props.isPlaying() ? "Stop playback" : "Start playback"}
          title={`${props.isPlaying() ? "Stop" : "Play"} (${props.keyHint(
            "transport.play_stop",
          )})`}
        >
          <Show when={props.isPlaying()} fallback={<HiSolidPlay size={22} />}>
            <HiSolidStop size={22} />
          </Show>
        </button>
        <button
          type="button"
          class="loop-toggle"
          onClick={() => props.onToggleLoop()}
          aria-pressed={props.loopEnabled() ? "true" : "false"}
          aria-label={props.loopEnabled() ? "Disable loop" : "Enable loop"}
          title={props.loopEnabled() ? "Disable loop" : "Enable loop"}
        >
          <HiSolidArrowPathRoundedSquare size={18} />
        </button>
        <button
          type="button"
          class="metronome-toggle"
          onClick={() => props.onToggleMetronome()}
          aria-pressed={props.metronomeEnabled() ? "true" : "false"}
          aria-label={props.metronomeEnabled() ? "Disable metronome" : "Enable metronome"}
          title={`Metronome (${props.keyHint("transport.metronome")})`}
        >
          <HiSolidMusicalNote size={18} />
        </button>
        <div class="tempo-control">
          {/* The label is the input's only accessible name — no
					    aria-label to override it — and the unit is decorative
					    text the name already carries. */}
          <label class="visually-hidden" for="tempo-input">
            Tempo (BPM)
          </label>
          <input
            id="tempo-input"
            type="number"
            class="tempo-input"
            min={MIN_TEMPO_BPM}
            max={MAX_TEMPO_BPM}
            step={1}
            value={props.tempo()}
            onChange={(event) => props.onTempoChange(event.currentTarget.valueAsNumber)}
          />
          <span class="tempo-unit" aria-hidden="true">
            BPM
          </span>
        </div>
        <Show when={props.timeSignature()}>
          {(signature) => (
            <span class="time-signature" title="Time signature (fixed at 4/4)">
              <span class="visually-hidden">Time signature </span>
              {signature().numerator}/{signature().denominator}
            </span>
          )}
        </Show>
        <span class="playhead-position" title="Playhead (bar.beat)">
          <span class="visually-hidden">Playhead at bar </span>
          {props.playheadLabel()}
        </span>
      </div>
      <button
        type="button"
        class="library-toggle"
        aria-label="Library"
        aria-pressed={props.libraryOpen() ? "true" : "false"}
        title="Library"
        onClick={() => props.onToggleLibrary()}
      >
        <HiSolidRectangleStack size={18} />
      </button>
      <button
        type="button"
        class="shortcut-guide-button"
        aria-label="Keyboard shortcuts"
        title={`Keyboard shortcuts (${props.keyHint("help.shortcut_guide")})`}
        onClick={() => props.onOpenGuide()}
      >
        <HiSolidQuestionMarkCircle size={18} />
      </button>
      <SaveStatus saveStatus={props.saveStatus} onRetry={props.onRetrySave} />
    </header>
  );
}
