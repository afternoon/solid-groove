import {
  HiSolidArrowPathRoundedSquare,
  HiSolidArrowUturnLeft,
  HiSolidArrowUturnRight,
  HiSolidMusicalNote,
  HiSolidPlay,
  HiSolidQuestionMarkCircle,
  HiSolidSquares2x2,
  HiSolidStop,
} from "solid-icons/hi";
import { type Accessor, Show } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import { MAX_TEMPO_BPM, MIN_TEMPO_BPM } from "../audio/Transport";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { ariaBool } from "../shared/aria";
import type { shortcutLabel } from "../shortcuts";
import PlayheadInput from "./PlayheadInput";
import SaveStatus from "./SaveStatus";
import type { UseEditorSessionResult } from "./useEditorSession";
import type { ProjectAudioControls } from "./useProjectAudio";

/**
 * The slice of the audio module the header drives. It is handed the module
 * whole (`REFACTOR-006`, ADR 0004) — never destructured at the seam, so every
 * accessor keeps its tracking — and narrowed here only so a test fake need not
 * build the whole engine. A new transport control widens this `Pick` and adds
 * its button; nothing between `useProjectAudio` and the header changes.
 */
export type HeaderAudio = Pick<
  ProjectAudioControls,
  | "isPlaying"
  | "positionTicks"
  | "loopEnabled"
  | "metronomeEnabled"
  | "toggle"
  | "toggleMetronome"
  | "seekTicks"
>;

/** The slice of the editor session the header reads: history and save state. */
export type HeaderSession = Pick<
  UseEditorSessionResult,
  "state" | "undo" | "redo" | "retry"
>;

export interface EditorHeaderProps {
  readonly projectName: string;
  readonly session: HeaderSession;
  readonly audio: HeaderAudio;
  /**
   * The loop is song state (LOOP-017), toggled through a `loop.setEnabled`
   * command rather than the audio module, so its action comes from the editor.
   */
  readonly onToggleLoop: () => void;
  readonly tempo: Accessor<number>;
  readonly onTempoChange: (value: number) => void;
  readonly onOpenGuide: () => void;
  readonly keyHint: (action: Parameters<typeof shortcutLabel>[0]) => string;
  /** Injected in tests; defaults to the app-wide instance. */
  readonly analytics?: Analytics;
}

/**
 * The editor's top bar, in three sections (#340): the back link and project
 * name on the left; undo/redo, transport, tempo, metronome, and the editable
 * playhead in the centre; save state and the shortcut-guide toggle on the
 * right (share joins them later). Split out of `EditorView` (`REFACTOR-001`) to shrink the parent's
 * merge-clash surface, then handed the audio and session modules whole
 * (`REFACTOR-006`) rather than one prop per field. Props are read as
 * `props.audio.isPlaying()`, never destructured, so Solid keeps tracking them.
 */
export default function EditorHeader(props: EditorHeaderProps) {
  const history = () => props.session.state;
  const analytics = () => props.analytics ?? defaultAnalytics;
  function seek(ticks: number): void {
    analytics().logFeatureFirstUse("playhead_seek");
    props.audio.seekTicks(ticks);
  }
  return (
    <header class="editor-header">
      <div class="editor-header-start">
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
      </div>
      <div class="editor-header-center transport-controls">
        <button
          type="button"
          class="undo-button"
          disabled={!history().canUndo}
          aria-label={history().undoSummary ? `Undo ${history().undoSummary}` : "Undo"}
          title={`${history().undoSummary ?? "Undo"} (${props.keyHint("edit.undo")})`}
          onClick={() => props.session.undo()}
        >
          <HiSolidArrowUturnLeft size={18} />
        </button>
        <button
          type="button"
          class="redo-button"
          disabled={!history().canRedo}
          aria-label={history().redoSummary ? `Redo ${history().redoSummary}` : "Redo"}
          title={`${history().redoSummary ?? "Redo"} (${props.keyHint("edit.redo")})`}
          onClick={() => props.session.redo()}
        >
          <HiSolidArrowUturnRight size={18} />
        </button>
        <button
          type="button"
          class="transport-toggle"
          onClick={() => void props.audio.toggle()}
          aria-pressed={ariaBool(props.audio.isPlaying())}
          aria-label={props.audio.isPlaying() ? "Stop playback" : "Start playback"}
          title={`${props.audio.isPlaying() ? "Stop" : "Play"} (${props.keyHint(
            "transport.play_stop",
          )})`}
        >
          <Show when={props.audio.isPlaying()} fallback={<HiSolidPlay size={22} />}>
            <HiSolidStop size={22} />
          </Show>
        </button>
        <button
          type="button"
          class="loop-toggle"
          onClick={() => props.onToggleLoop()}
          aria-pressed={ariaBool(props.audio.loopEnabled())}
          aria-label={props.audio.loopEnabled() ? "Disable loop" : "Enable loop"}
          title={`${props.audio.loopEnabled() ? "Disable loop" : "Enable loop"} (${props.keyHint(
            "transport.toggle_loop",
          )})`}
        >
          <HiSolidArrowPathRoundedSquare size={18} />
        </button>
        <div class="tempo-control">
          {/* The label is the input's only accessible name — no
					    aria-label to override it — and it carries the unit the
					    field no longer prints. */}
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
        </div>
        <button
          type="button"
          class="metronome-toggle"
          onClick={() => props.audio.toggleMetronome()}
          aria-pressed={ariaBool(props.audio.metronomeEnabled())}
          aria-label={
            props.audio.metronomeEnabled() ? "Disable metronome" : "Enable metronome"
          }
          title={`Metronome (${props.keyHint("transport.metronome")})`}
        >
          <HiSolidMusicalNote size={18} />
        </button>
        <PlayheadInput positionTicks={props.audio.positionTicks} onSeek={seek} />
      </div>
      <div class="editor-header-end">
        <SaveStatus
          saveStatus={() => history().saveStatus}
          onRetry={() => void props.session.retry()}
        />
        <button
          type="button"
          class="shortcut-guide-button"
          aria-label="Keyboard shortcuts"
          title={`Keyboard shortcuts (${props.keyHint("help.shortcut_guide")})`}
          onClick={() => props.onOpenGuide()}
        >
          <HiSolidQuestionMarkCircle size={18} />
        </button>
      </div>
    </header>
  );
}
