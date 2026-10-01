import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { Analytics } from "../../analytics/analytics";
import type { ErrorCode } from "../../analytics/errorCodes";
import { OfflineRenderError } from "../../audio/offlineRenderer";
import Dialog from "../../components/Dialog";
import type { Project } from "../../domain/entities";
import { StemExportError } from "../../export/stems/exportStems";
import { systemClock } from "../../shared/clock";
import { useShortcuts } from "../../shortcuts";
import DownloadsRow from "./DownloadsRow";
import { downloadCards } from "./downloadCards";
import { downloadFile } from "./downloadFile";
import ExportFooter, { EXPORT_NOTE_ID } from "./ExportFooter";
import ExportTitleRow from "./ExportTitleRow";
import { estimateStereoBytes, exportFacts } from "./exportFacts";
import { stemsNote } from "./exportNotes";
import FormatCards, { type ExportFormat } from "./FormatCards";
import { formatBytes } from "./stemSelection";
import { exportStemsBatch, planStemsFiles } from "./stemsExport";
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
  readonly exportStemsBatch?: typeof exportStemsBatch;
  readonly download?: typeof downloadFile;
  onClose(): void;
}

type Phase =
  | { readonly kind: "choose" }
  | {
      readonly kind: "rendering";
      /** The ZIP being printed (0 for a stereo WAV) and how far along it is. */
      readonly batch: number;
      readonly fraction: number;
    }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly code: ErrorCode; readonly batch: number };

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
 * tracks the producer selects. Stems never block on size (EXP-004): a
 * selection over the budget is split, in track order, into ZIPs that each fit,
 * and each ZIP is rendered, downloaded and released before the next starts.
 * While a render runs the dialog shows its progress beside a Cancel button,
 * and closing the dialog cancels it too, so a render never outlives the
 * surface that started it. A file is downloaded only once it has rendered
 * whole: a cancelled or failed ZIP never reaches the browser's downloads, and
 * the ZIPs before it stay there.
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
  const stamp = new Date(systemClock.now());
  const plan = createMemo(() => planStemsFiles(props.project(), list.trackIds()));
  const stereoBytes = createMemo(() => estimateStereoBytes(props.project()));
  /** How many files this export makes: the ZIPs, or the one WAV. */
  const fileCount = () => (format() === "stems" ? plan().length : 1);
  /** The ZIPs already downloaded, in order, and where Export picks up again. */
  const [got, setGot] = createSignal(0);
  const [resumeFrom, setResumeFrom] = createSignal(0);
  const [scrollTo, setScrollTo] = createSignal<string | null>(null);
  const batchRows = createMemo(() =>
    format() === "stems" ? plan().map((batch) => batch.rowIds) : [],
  );
  const printing = () => {
    const current = rendering();
    return current && { batchIndex: current.batch, fraction: current.fraction };
  };
  const failedBatch = () => {
    const current = phase();
    return current.kind === "failed" ? current.batch : null;
  };
  const cards = createMemo(() => {
    const now = printing();
    return downloadCards({
      format: format(),
      projectName: props.project().metadata.name,
      date: stamp,
      batches: plan(),
      stereoBytes: stereoBytes(),
      progress: {
        done: got(),
        printing: now && { index: now.batchIndex, fraction: now.fraction },
        failed: failedBatch(),
      },
    });
  });
  const noTracks = () => format() === "stems" && list.trackIds().length === 0;
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
  let startedAt = 0;

  const cancel = () => controller?.abort();
  const close = () => {
    cancel();
    props.onClose();
  };
  onCleanup(cancel);

  /** Changing the format or the selection starts the export over. */
  const startOver = () => {
    setGot(0);
    setResumeFrom(0);
    if (phase().kind === "failed") setPhase({ kind: "choose" });
  };
  createEffect(
    () => list.trackIds().join(","),
    () => {
      if (phase().kind !== "rendering") startOver();
    },
  );

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
    const stems = format() === "stems";
    const batches = plan();
    const count = stems ? batches.length : 1;
    if (resumeFrom() === 0) {
      setGot(0);
      startedAt = systemClock.now();
    }
    let index = resumeFrom();
    try {
      for (; index < count; index++) {
        setPhase({ kind: "rendering", batch: index, fraction: 0 });
        if (stems) setScrollTo(batches[index].rowIds[0] ?? null);
        const options: StereoExportOptions = {
          signal: current.signal,
          analytics: props.analytics,
          onProgress: (fraction) => {
            if (!current.signal.aborted) {
              setPhase({ kind: "rendering", batch: index, fraction });
            }
          },
        };
        const file = stems
          ? await (props.exportStemsBatch ?? exportStemsBatch)(props.project(), {
              ...options,
              batch: batches[index],
              count,
              startedAt,
              date: stamp,
              trackIds: list.trackIds(),
            })
          : await (props.exportWav ?? exportStereoWav)(props.project(), options);
        // A ZIP that finished after Cancel is not downloaded; the next ZIP's
        // call sees the aborted signal and ends the export as cancelled.
        if (current.signal.aborted) continue;
        (props.download ?? downloadFile)(file.blob, file.fileName);
        setGot(index + 1);
      }
      if (current.signal.aborted) throw new StemExportError("aborted", "cancelled");
      setPhase({ kind: "done" });
    } catch (error) {
      if (controller !== current) return;
      const coded =
        error instanceof OfflineRenderError || error instanceof StemExportError;
      const code = coded ? error.code : "internal";
      setResumeFrom(got());
      setPhase(
        code === "aborted" ? { kind: "choose" } : { kind: "failed", code, batch: index },
      );
    } finally {
      if (controller === current) controller = undefined;
    }
  }

  const failed = () => {
    const current = phase();
    return current.kind === "failed" ? current : null;
  };
  const stemsBytes = () => plan().reduce((sum, batch) => sum + batch.bytes, 0);
  const sizeText = () => {
    if (format() === "stereo") return `${formatBytes(stereoBytes())} · 1 file`;
    const files = plan().reduce((sum, batch) => sum + batch.paths.length, 0);
    return `${formatBytes(stemsBytes())} · ${files} ${files === 1 ? "file" : "files"}`;
  };
  /** What is printing, `ZIP 2 of 3 · bar 79 of 160`, and how far along the whole is. */
  const printingText = () => {
    const current = rendering();
    if (!current) return null;
    const count = fileCount();
    const bars = list.bars();
    const bar = Math.max(1, Math.ceil(current.fraction * bars));
    const zip =
      format() === "stems" && count > 1 ? `ZIP ${current.batch + 1} of ${count} · ` : "";
    return {
      text: `${zip}bar ${bar} of ${bars}`,
      fraction: (current.batch + current.fraction) / count,
    };
  };
  /** The note under the footer: why Export is off, how the stems split, or that it is done. */
  const noteText = () => {
    if (rendering()) {
      return got() > 0 ? `${got()} of ${fileCount()} in your downloads.` : "";
    }
    if (phase().kind === "done") {
      return `Export complete. Your ${format() === "stems" ? "stems are" : "WAV is"} in your downloads.`;
    }
    if (format() !== "stems") return "";
    return stemsNote({
      tracks: list.trackIds().length,
      zips: plan().length,
      bytes: stemsBytes(),
    });
  };
  const alertText = () => {
    const current = failed();
    return current ? failureMessage(current.code, format()) : "";
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
          startOver();
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
          batches={batchRows()}
          doneBatches={Array.from({ length: got() }, (_, i) => i)}
          idle={phase().kind === "choose"}
          printing={printing()}
          scrollToRowId={scrollTo()}
          onRowClick={(index, modifiers) => {
            list.click(index, modifiers);
            focusList();
          }}
          onPickAction={list.pick}
          onFocusChange={list.setFocused}
        />
      </div>
      <DownloadsRow cards={cards()} />
      <ExportFooter
        format={format()}
        size={sizeText()}
        zipCount={plan().length}
        printing={printingText()}
        note={noteText()}
        alert={alertText()}
      >
        <Show
          when={rendering()}
          fallback={
            <>
              <button type="button" class="export-secondary" onClick={close}>
                Close
              </button>
              <button
                type="button"
                class="export-primary"
                aria-disabled={noTracks() ? "true" : undefined}
                aria-describedby={noTracks() ? EXPORT_NOTE_ID : undefined}
                onClick={() => {
                  // Off stays focusable, so its reason is read out; it does nothing.
                  if (!noTracks()) void start();
                }}
              >
                {resumeFrom() > 0 ? `Resume from ZIP ${resumeFrom() + 1}` : "Export"}
              </button>
            </>
          }
        >
          <button type="button" class="export-secondary" onClick={cancel}>
            Cancel
          </button>
        </Show>
      </ExportFooter>
    </Dialog>
  );
}
