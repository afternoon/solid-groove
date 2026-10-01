import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import type { Analytics } from "../../analytics/analytics";
import type { ErrorCode } from "../../analytics/errorCodes";
import { OfflineRenderError } from "../../audio/offlineRenderer";
import Dialog from "../../components/Dialog";
import type { Project } from "../../domain/entities";
import { StemExportError } from "../../export/stems/exportStems";
import { systemClock } from "../../shared/clock";
import { useShortcuts } from "../../shortcuts";
import DownloadsRow, { type DownloadState } from "./DownloadsRow";
import { downloadCards } from "./downloadCards";
import { downloadFile } from "./downloadFile";
import ExportTitleRow from "./ExportTitleRow";
import { estimateStereoBytes, exportFacts } from "./exportFacts";
import FormatCards, { type ExportFormat } from "./FormatCards";
import StemsBudgetNote, { STEMS_BLOCKER_ID } from "./StemsBudgetNote";
import { stemsBlocker } from "./stemSelection";
import { estimateStemsFile, exportStemsFile, planStemsFiles } from "./stemsExport";
import { exportStereoWav, type StereoExportOptions } from "./stereoExport";
import TrackLanes from "./TrackLanes";
import { useTrackList } from "./useTrackList";
import "./ExportDialog.css";

export interface ExportDialogProps {
  /** The project as it is when Export is pressed; the render reads only that. */
  readonly project: () => Project;
  readonly analytics?: Analytics;
  /** Test seams: the export itself, and how its file reaches the browser. */
  readonly exportWav?: typeof exportStereoWav;
  readonly exportStems?: typeof exportStemsFile;
  readonly download?: typeof downloadFile;
  onClose(): void;
}

type Phase =
  | { readonly kind: "choose" }
  | { readonly kind: "rendering"; readonly progress: number }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly code: ErrorCode };

type Format = ExportFormat;

/** What a failed export tells the producer to do about it. */
export function failureMessage(code: ErrorCode, format: Format = "stereo"): string {
  if (code === "quota_exceeded" && format === "stems") {
    return "These stems came out over the 2 GiB export limit. Deselect a track and try again.";
  }
  switch (code) {
    case "decode_failed":
    case "asset_missing":
      return "A sound in this project could not be loaded. Check your connection and try again.";
    case "not_supported":
      return "This browser cannot render audio offline. Try a current version of Chrome, Firefox or Safari.";
    case "quota_exceeded":
      return "The song is too long to export as one WAV file. Shorten the arrangement and try again.";
    default:
      return "Something went wrong while rendering. Try again.";
  }
}

/**
 * The Export dialog (EXP-002, CF-021): choose a format, render, download.
 *
 * Stereo WAV renders the song as one file; Stems (ZIP) renders one aligned
 * 24-bit WAV per track and return plus a reference mix (EXP-003), for the
 * tracks the producer selects: all of them unless some are unchecked. Export
 * is blocked, with the reason, while that selection is over the size budget.
 * While a render runs the dialog shows its
 * progress beside a Cancel button, and closing the dialog cancels it too, so a
 * render never outlives the surface that started it. The file is downloaded
 * only once the whole render has succeeded: a cancelled or failed export never
 * reaches the browser's downloads.
 */
export default function ExportDialog(props: ExportDialogProps): JSX.Element {
  const [phase, setPhase] = createSignal<Phase>({ kind: "choose" });
  const [format, setFormat] = createSignal<Format>("stereo");
  const facts = createMemo(() => exportFacts(props.project()));
  const list = useTrackList({
    project: props.project,
    editable: () => format() === "stems" && phase().kind !== "rendering",
    stereo: () => format() === "stereo",
  });
  const rendering = () => {
    const current = phase();
    return current.kind === "rendering" ? current : null;
  };
  const cardState = (): DownloadState => {
    const current = phase().kind;
    if (current === "rendering") return "now";
    if (current === "done") return "done";
    return current === "failed" ? "bad" : "waiting";
  };
  const stamp = new Date(systemClock.now());
  const plan = createMemo(() => planStemsFiles(props.project(), list.trackIds()));
  const stereoBytes = createMemo(() => estimateStereoBytes(props.project()));
  const printing = () => {
    const current = rendering();
    return current ? { batchIndex: 0, fraction: current.progress } : null;
  };
  const cards = createMemo(() =>
    downloadCards({
      format: format(),
      projectName: props.project().metadata.name,
      date: stamp,
      batches: plan(),
      stereoBytes: stereoBytes(),
      state: cardState(),
      fraction: rendering()?.progress ?? 0,
    }),
  );
  /** Every row the export includes, so the playhead prints returns as well as tracks. */
  const printedRows = createMemo(() =>
    list
      .rows()
      .filter((row) => row.included)
      .map((row) => row.id),
  );
  const estimate = createMemo(() => estimateStemsFile(props.project(), list.trackIds()));
  const blocker = createMemo(() => stemsBlocker(list.trackIds().length, estimate()));
  const blocked = () => format() === "stems" && blocker() !== null;
  let root!: HTMLDivElement;
  /** Keys reach the list only while it has focus, so a click hands it focus. */
  const focusList = () =>
    queueMicrotask(() => root.querySelector<HTMLElement>('[role="listbox"]')?.focus());
  // The row the keys are on stays in view as they move it.
  createEffect(
    () => list.focusId(),
    () => {
      const active = root
        .querySelector('[role="listbox"]')
        ?.getAttribute("aria-activedescendant");
      if (active) document.getElementById(active)?.scrollIntoView?.({ block: "nearest" });
    },
  );
  let controller: AbortController | undefined;

  const cancel = () => controller?.abort();
  const close = () => {
    cancel();
    props.onClose();
  };
  onCleanup(cancel);

  // Escape clears the list's picks first, and closes only when there were none.
  useShortcuts({
    handlers: () => ({
      ...list.handlers(),
      "view.close_surface": {
        run: () => {
          if (!list.run("clear_picks")) close();
        },
      },
    }),
    contexts: list.contexts,
  });

  async function start(): Promise<void> {
    const current = new AbortController();
    controller = current;
    setPhase({ kind: "rendering", progress: 0 });
    const options: StereoExportOptions = {
      signal: current.signal,
      analytics: props.analytics,
      onProgress: (progress) => {
        if (!current.signal.aborted) setPhase({ kind: "rendering", progress });
      },
    };
    try {
      const file =
        format() === "stems"
          ? await (props.exportStems ?? exportStemsFile)(props.project(), {
              ...options,
              trackIds: list.trackIds(),
            })
          : await (props.exportWav ?? exportStereoWav)(props.project(), options);
      if (current.signal.aborted) return;
      (props.download ?? downloadFile)(file.blob, file.fileName);
      setPhase({ kind: "done" });
    } catch (error) {
      if (controller !== current) return;
      const coded =
        error instanceof OfflineRenderError || error instanceof StemExportError;
      const code = coded ? error.code : "internal";
      setPhase(code === "aborted" ? { kind: "choose" } : { kind: "failed", code });
    } finally {
      if (controller === current) controller = undefined;
    }
  }

  const failed = () => {
    const current = phase();
    return current.kind === "failed" ? current : null;
  };

  return (
    <Dialog label="Export" class="export-shell" flush onClose={close}>
      <ExportTitleRow facts={facts()} />
      <FormatCards
        value={format()}
        disabled={phase().kind === "rendering"}
        onChange={(next) => {
          list.pick("clear");
          setFormat(next);
        }}
      />
      <div ref={root}>
        <TrackLanes
          rows={list.rows()}
          bars={list.bars()}
          focusId={list.focusId()}
          readOnly={format() === "stereo"}
          disabled={phase().kind === "rendering"}
          heightPx={250}
          batches={format() === "stems" ? [printedRows()] : []}
          doneBatches={phase().kind === "done" ? [0] : []}
          printing={printing()}
          onRowClick={(index, modifiers) => {
            list.click(index, modifiers);
            focusList();
          }}
          onPickAction={list.pick}
          onFocusChange={list.setFocused}
        />
      </div>
      <DownloadsRow cards={cards()} />
      <div class="export-dialog">
        <Show when={format() === "stems"}>
          <StemsBudgetNote estimate={estimate()} blocker={blocker()} />
        </Show>
        <p class="export-note">
          <Show
            when={format() === "stems"}
            fallback={
              <>
                The whole song, from bar 1 to the end of its last clip plus its release
                tail, as 24-bit stereo at the project's own level.
              </>
            }
          >
            One 24-bit WAV per track and return, plus a reference mix, all from bar 1 and
            all the same length, at the project's own level and without master effects.
          </Show>
        </p>
        <Switch>
          <Match when={rendering()}>
            {(current) => (
              <div class="export-progress">
                <progress
                  aria-label="Export progress"
                  max={1}
                  value={current().progress}
                />
                <button type="button" onClick={cancel}>
                  Cancel
                </button>
              </div>
            )}
          </Match>
          <Match when={phase().kind === "done"}>
            <output class="export-status">
              Export complete. Your {format() === "stems" ? "stems are" : "WAV is"} in
              your downloads.
            </output>
          </Match>
          <Match when={failed()}>
            {(current) => (
              <p class="export-status export-error" role="alert">
                {failureMessage(current().code, format())}
              </p>
            )}
          </Match>
        </Switch>
        <div class="export-actions">
          <button
            type="button"
            class="export-start"
            disabled={phase().kind === "rendering"}
            aria-disabled={blocked() ? "true" : undefined}
            aria-describedby={blocked() ? STEMS_BLOCKER_ID : undefined}
            onClick={() => {
              // Blocked stays focusable, so its reason is read out; it does nothing.
              if (!blocked()) void start();
            }}
          >
            Export
          </button>
        </div>
      </div>
    </Dialog>
  );
}
