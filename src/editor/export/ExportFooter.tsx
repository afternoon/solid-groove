import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { ExportFormat } from "./FormatCards";
import "./ExportFooter.css";

/** The id of the one-line note, which says why Export is blocked, for `aria-describedby`. */
export const EXPORT_NOTE_ID = "export-stems-blocker";

export interface ExportFooterProps {
  readonly format: ExportFormat;
  /** `1.3 GiB · 21 files`. */
  readonly size: string;
  /** How many ZIPs the stems come as. */
  readonly zipCount: number;
  /** While an export runs: what is printing, and how far along the whole is. */
  readonly printing: { readonly text: string; readonly fraction: number } | null;
  /** The message slot's note, in secondary text. */
  readonly note: string;
  /** The message slot's failure, in the framed error style. */
  readonly alert: string;
  /** The actions, right-aligned in a box of fixed width. */
  readonly children: JSX.Element;
}

function Readout(props: {
  readonly label: string;
  readonly widthPx: number;
  /** The second slot sets its label 8px off its value; the first keeps 1px. */
  readonly loose?: boolean;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <div
      class={["export-slot", { loose: props.loose === true }]}
      style={{ width: `${props.widthPx}px` }}
    >
      <span class="export-label">{props.label}</span>
      {props.children}
    </div>
  );
}

/**
 * The footer of the Release design (EXP-004). Everything in it has a fixed
 * size, so a label change, a message or a failure moves nothing: the readouts
 * sit in fixed-width slots, the actions in a fixed-width box, and the message
 * in a fixed one-line slot under them, which never wraps. The alert is always
 * mounted and only its content changes, so a screen reader announces each one.
 */
export default function ExportFooter(props: ExportFooterProps): JSX.Element {
  return (
    <div class="export-footer">
      <Readout label={props.printing ? "Printing" : "Size"} widthPx={230}>
        <b class="export-value">{props.printing ? props.printing.text : props.size}</b>
      </Readout>
      <Readout
        label={
          props.printing ? "Progress" : props.format === "stereo" ? "Level" : "Downloads"
        }
        widthPx={220}
        loose
      >
        <Show
          when={props.printing}
          fallback={
            <Show
              when={props.format === "stems"}
              fallback={<span class="export-level">Project level, not normalized</span>}
            >
              <b class="export-value">
                {props.zipCount === 1
                  ? "1 ZIP"
                  : `${props.zipCount} ZIPs, each under 2 GiB`}
              </b>
            </Show>
          }
        >
          {(printing) => (
            <progress aria-label="Export progress" max={1} value={printing().fraction} />
          )}
        </Show>
      </Readout>
      <span class="export-footer-fill" />
      <div class="export-actions">{props.children}</div>
      <div class="export-message">
        <div class={["export-alert", { shown: props.alert !== "" }]} role="alert">
          {props.alert}
        </div>
        <output class="export-note" id={EXPORT_NOTE_ID} aria-live="polite">
          {props.note}
        </output>
      </div>
    </div>
  );
}
