import type { JSX } from "@solidjs/web";
import { createSignal, Match, onCleanup, Switch } from "solid-js";
import type { Analytics } from "../../analytics/analytics";
import type { ErrorCode } from "../../analytics/errorCodes";
import { OfflineRenderError } from "../../audio/offlineRenderer";
import Dialog from "../../components/Dialog";
import type { Project } from "../../domain/entities";
import { type ShortcutContext, useShortcuts } from "../../shortcuts";
import { downloadBytes } from "./downloadBytes";
import { exportStereoWav, type StereoExportOptions } from "./stereoExport";
import "./ExportDialog.css";

export interface ExportDialogProps {
  /** The project as it is when Export is pressed; the render reads only that. */
  readonly project: () => Project;
  readonly analytics?: Analytics;
  /** Test seams: the export itself, and how its file reaches the browser. */
  readonly exportWav?: typeof exportStereoWav;
  readonly download?: typeof downloadBytes;
  onClose(): void;
}

type Phase =
  | { readonly kind: "choose" }
  | { readonly kind: "rendering"; readonly progress: number }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly code: ErrorCode };

const DIALOG_CONTEXTS: readonly ShortcutContext[] = ["dialog"];

/** What a failed export tells the producer to do about it. */
export function failureMessage(code: ErrorCode): string {
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
 * Stereo WAV is the one format it can make today; Stems (ZIP) is shown, and
 * disabled, because #66 fills it in. While a render runs the dialog shows its
 * progress beside a Cancel button, and closing the dialog cancels it too, so a
 * render never outlives the surface that started it. The file is downloaded
 * only once the whole render has succeeded: a cancelled or failed export never
 * reaches the browser's downloads.
 */
export default function ExportDialog(props: ExportDialogProps): JSX.Element {
  const [phase, setPhase] = createSignal<Phase>({ kind: "choose" });
  let controller: AbortController | undefined;

  const cancel = () => controller?.abort();
  const close = () => {
    cancel();
    props.onClose();
  };
  onCleanup(cancel);

  useShortcuts({
    handlers: () => ({ "view.close_surface": { run: close } }),
    contexts: () => DIALOG_CONTEXTS,
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
      const file = await (props.exportWav ?? exportStereoWav)(props.project(), options);
      if (current.signal.aborted) return;
      (props.download ?? downloadBytes)(file.bytes, file.fileName, "audio/wav");
      setPhase({ kind: "done" });
    } catch (error) {
      if (controller !== current) return;
      const code = error instanceof OfflineRenderError ? error.code : "internal";
      setPhase(code === "aborted" ? { kind: "choose" } : { kind: "failed", code });
    } finally {
      if (controller === current) controller = undefined;
    }
  }

  const rendering = () => {
    const current = phase();
    return current.kind === "rendering" ? current : null;
  };
  const failed = () => {
    const current = phase();
    return current.kind === "failed" ? current : null;
  };

  return (
    <Dialog label="Export" header={<h2 class="export-title">Export</h2>} onClose={close}>
      <div class="export-dialog">
        <fieldset class="export-formats" disabled={phase().kind === "rendering"}>
          <legend class="visually-hidden">Format</legend>
          <label class="export-format">
            <input type="radio" name="export-format" value="stereo" checked />
            <span>Stereo WAV</span>
          </label>
          <label class="export-format">
            <input type="radio" name="export-format" value="stems" disabled />
            <span>Stems (ZIP)</span>
          </label>
        </fieldset>
        <p class="export-note">
          The whole song, from bar 1 to the end of its last clip plus its release tail, as
          24-bit stereo at the project's own level.
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
              Export complete. Your WAV is in your downloads.
            </output>
          </Match>
          <Match when={failed()}>
            {(current) => (
              <p class="export-status export-error" role="alert">
                {failureMessage(current().code)}
              </p>
            )}
          </Match>
        </Switch>
        <div class="export-actions">
          <button
            type="button"
            class="export-start"
            disabled={phase().kind === "rendering"}
            onClick={() => void start()}
          >
            Export
          </button>
        </div>
      </div>
    </Dialog>
  );
}
