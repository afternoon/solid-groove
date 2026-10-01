import { Portal } from "@solidjs/web";
import { HiSolidQuestionMarkCircle, HiSolidSquares2x2 } from "solid-icons/hi";
import { type Accessor, createEffect, createSignal, Show } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import { MAX_TEMPO_BPM, MIN_TEMPO_BPM } from "../audio/Transport";
import {
  LoopIcon,
  MetronomeIcon,
  PlayIcon,
  RedoIcon,
  StopIcon,
  UndoIcon,
} from "../components/icons";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { ariaBool } from "../shared/aria";
import type { shortcutLabel } from "../shortcuts";
import ExportDialog from "./export/ExportDialog";
import PlayheadInput from "./PlayheadInput";
import ProjectNameInput from "./ProjectNameInput";
import SaveStatus from "./SaveStatus";
import SwingButton from "./SwingButton";
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
  /** Commit a new project name: one `project.rename` through the command layer. */
  readonly onRename: (name: string) => void;
  readonly session: HeaderSession;
  readonly audio: HeaderAudio;
  /**
   * The loop is song state (LOOP-017), toggled through a `loop.setEnabled`
   * command rather than the audio module, so its action comes from the editor.
   */
  readonly onToggleLoop: () => void;
  readonly tempo: Accessor<number>;
  readonly onTempoChange: (value: number) => void;
  /** Song swing (%), 50-75, and the input/commit halves of its gesture (#500). */
  readonly swing: Accessor<number>;
  readonly onSwingInput: (value: number) => void;
  readonly onSwingCommit: (value: number) => void;
  readonly onOpenGuide: () => void;
  /** Told whether the Export dialog is open, so the editor's keys can stand down. */
  readonly onExportOpenChange?: (open: boolean) => void;
  readonly keyHint: (action: Parameters<typeof shortcutLabel>[0]) => string;
  /** Injected in tests; defaults to the app-wide instance. */
  readonly analytics?: Analytics;
}

/**
 * The editor's top bar, in three zones with one job each (#340, UI-003 #819):
 * the project (projects link, name) on the left; playing it ([play | loop],
 * the editable playhead, [tempo | swing | metronome]) in the centre; the
 * document ([undo | redo], save state, export, help) on the right. Every
 * control but the name and save state sits in one equal-height cell, and a
 * `header-cell-group` joins cells into one strip. Split out of `EditorView` (`REFACTOR-001`) to shrink the parent's
 * merge-clash surface, then handed the audio and session modules whole
 * (`REFACTOR-006`) rather than one prop per field. Props are read as
 * `props.audio.isPlaying()`, never destructured, so Solid keeps tracking them.
 */
export default function EditorHeader(props: EditorHeaderProps) {
  const history = () => props.session.state;
  const analytics = () => props.analytics ?? defaultAnalytics;
  const [renaming, setRenaming] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
  createEffect(exporting, (open) => {
    props.onExportOpenChange?.(open);
    return () => props.onExportOpenChange?.(false);
  });
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
          <HiSolidSquares2x2 size={16} />
        </a>
        {/* The project's name, chosen by the user (ADR 0002 decision 2). A click
            turns it into an input. */}
        <h1 class={`project-name ${MASK_CONTENT}`}>
          <Show
            when={renaming()}
            fallback={
              <button
                type="button"
                class="project-name-button"
                title="Rename project"
                onClick={() => setRenaming(true)}
              >
                {props.projectName}
              </button>
            }
          >
            <ProjectNameInput
              name={props.projectName}
              onRename={(name) => props.onRename(name)}
              onDone={() => setRenaming(false)}
            />
          </Show>
        </h1>
      </div>
      <div class="editor-header-center transport-controls">
        <div class="header-cell-group">
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
            <Show when={props.audio.isPlaying()} fallback={<PlayIcon size={18} />}>
              {/* A filled square outweighs a triangle at one size, so Stop
                  is drawn smaller to read as the same size as Play. */}
              <StopIcon size={14} />
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
            <LoopIcon size={18} />
          </button>
        </div>
        <PlayheadInput positionTicks={props.audio.positionTicks} onSeek={seek} />
        <div class="header-cell-group">
          <div class="tempo-control">
            {/* The label is the input's only accessible name — no
                aria-label to override it. The printed unit is decoration. */}
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
          <SwingButton
            swing={props.swing}
            onInput={props.onSwingInput}
            onCommit={props.onSwingCommit}
          />
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
            <MetronomeIcon size={18} />
          </button>
        </div>
      </div>
      <div class="editor-header-end">
        <div class="header-cell-group">
          <button
            type="button"
            class="undo-button"
            disabled={!history().canUndo}
            aria-label={history().undoSummary ? `Undo ${history().undoSummary}` : "Undo"}
            title={`${history().undoSummary ?? "Undo"} (${props.keyHint("edit.undo")})`}
            onClick={() => props.session.undo()}
          >
            <UndoIcon size={18} />
          </button>
          <button
            type="button"
            class="redo-button"
            disabled={!history().canRedo}
            aria-label={history().redoSummary ? `Redo ${history().redoSummary}` : "Redo"}
            title={`${history().redoSummary ?? "Redo"} (${props.keyHint("edit.redo")})`}
            onClick={() => props.session.redo()}
          >
            <RedoIcon size={18} />
          </button>
        </div>
        <SaveStatus
          saveStatus={() => history().saveStatus}
          onRetry={() => void props.session.retry()}
        />
        {/* Export (EXP-002): the dialog renders the project as it stands when
            Export is pressed, and never edits it. It is portalled to the body
            so the header's own button styles do not reach its controls. */}
        <button
          type="button"
          class="export-button"
          disabled={history().project === null}
          onClick={() => setExporting(true)}
        >
          Export
        </button>
        <Show when={exporting() && history().project}>
          {(project) => (
            <Portal>
              <ExportDialog
                project={project}
                analytics={props.analytics}
                onClose={() => setExporting(false)}
              />
            </Portal>
          )}
        </Show>
        <button
          type="button"
          class="shortcut-guide-button"
          aria-label="Keyboard shortcuts"
          title={`Keyboard shortcuts (${props.keyHint("help.shortcut_guide")})`}
          onClick={() => props.onOpenGuide()}
        >
          <HiSolidQuestionMarkCircle size={16} />
        </button>
      </div>
    </header>
  );
}
