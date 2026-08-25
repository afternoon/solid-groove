import type { JSX } from "solid-js";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import type { ShortcutContext, ShortcutHandlers } from "../shortcuts";
import { useShortcuts } from "../shortcuts";
import "./ConfirmDialog.css";

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Disables both actions while the confirmed action is in flight. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A modal suppresses every other context while it is open (PRD `KEY-01`). */
const DIALOG_CONTEXTS: readonly ShortcutContext[] = ["dialog"];

/**
 * A minimal, accessible confirmation modal for destructive actions (PRD
 * `PRJ-02`: "Destructive deletion requires confirmation").
 *
 * `role="alertdialog"` plus `aria-modal` marks it for assistive technology.
 * Dismissal is keyboard-first rather than click-outside: the `Escape` key and
 * the `Cancel` button both cancel, so nothing here needs a mouse-only handler
 * on a non-interactive backdrop element.
 *
 * `Escape` is not compared here: it is `view.close_surface` in the `KEY-01`
 * registry, dispatched by the shared `ShortcutController` like every other
 * mapping. That is what keeps the combination written down once, and it picks
 * up the text-entry rule and the `shortcut_used` measurement for free.
 */
export default function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  useShortcuts({
    handlers: (): ShortcutHandlers => ({
      "view.close_surface": {
        run: () => props.onCancel(),
        // Both buttons are disabled while the confirmed action is in flight.
        // Escape is the same affordance as Cancel, so it follows them rather
        // than dismissing a dialog whose action is still running.
        isEnabled: () => props.busy !== true,
      },
    }),
    contexts: () => DIALOG_CONTEXTS,
  });

  return (
    <div class="confirm-dialog-backdrop">
      <div
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={props.title}
      >
        {/* The title interpolates a name a user typed — `Delete "…"?` from the
				    mixer, a project name from the dashboard — so it is masked. The
				    message below is not: it is fixed explanatory copy, and a delete
				    confirmation is exactly the friction replay exists to show, so
				    greying the whole dialog would cost the observation and protect
				    nothing extra. `aria-label` above carries the same name and is
				    covered by `MASK_ATTRIBUTES` (ADR 0003). */}
        <p class={`confirm-dialog-title ${MASK_CONTENT}`}>{props.title}</p>
        <p class="confirm-dialog-message">{props.message}</p>
        <div class="confirm-dialog-actions">
          <button
            type="button"
            class="confirm-dialog-cancel"
            disabled={props.busy}
            onClick={() => props.onCancel()}
          >
            {props.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            class="confirm-dialog-confirm"
            disabled={props.busy}
            onClick={() => props.onConfirm()}
          >
            {props.confirmLabel ?? "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
