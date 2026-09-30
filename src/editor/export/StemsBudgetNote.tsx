import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { StemExportEstimate } from "../../export/stems/exportStems";
import { formatBytes } from "./stemSelection";

export interface StemsBudgetNoteProps {
  readonly estimate: StemExportEstimate;
  /** Why Export is blocked for this selection; `null` when it is not. */
  readonly blocker: string | null;
}

/** The id of the words that say why Export is blocked, for `aria-describedby`. */
export const STEMS_BLOCKER_ID = "export-stems-blocker";

/**
 * The stems selection's estimated size and, while it cannot be exported, the
 * reason why. The reason's live region stays mounted and only its content
 * changes, so a screen reader announces each new reason.
 */
export default function StemsBudgetNote(props: StemsBudgetNoteProps): JSX.Element {
  return (
    <>
      <p class="export-size" aria-live="polite">
        Estimated size: about {formatBytes(props.estimate.bytes)} of{" "}
        {formatBytes(props.estimate.limitBytes)}.
      </p>
      <div id={STEMS_BLOCKER_ID} aria-live="polite">
        <Show when={props.blocker}>
          {(reason) => <p class="export-status export-error">{reason()}</p>}
        </Show>
      </div>
    </>
  );
}
