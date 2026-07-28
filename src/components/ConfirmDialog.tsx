import { createEffect, type JSX, onCleanup } from "solid-js";
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

/**
 * A minimal, accessible confirmation modal for destructive actions (PRD
 * `PRJ-02`: "Destructive deletion requires confirmation").
 *
 * `role="alertdialog"` plus `aria-modal` marks it for assistive technology.
 * Dismissal is keyboard-first rather than click-outside: the `Escape` key and
 * the `Cancel` button both cancel, so nothing here needs a mouse-only handler
 * on a non-interactive backdrop element.
 */
export default function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
	createEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") props.onCancel();
		};
		document.addEventListener("keydown", onKeyDown);
		onCleanup(() => document.removeEventListener("keydown", onKeyDown));
	});

	return (
		<div class="confirm-dialog-backdrop">
			<div
				class="confirm-dialog"
				role="alertdialog"
				aria-modal="true"
				aria-label={props.title}
			>
				<p class="confirm-dialog-title">{props.title}</p>
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
