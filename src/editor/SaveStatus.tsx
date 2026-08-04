import { type Accessor, Show } from "solid-js";
import type { SaveStatus as SaveStatusValue } from "../persistence/autosave";
import type { SaveFailureReason } from "../persistence/projectRepository";

const SAVE_STATUS_LABEL: Record<string, string> = {
	idle: "",
	pending: "Saving…",
	saving: "Saving…",
	saved: "Saved",
	failed: "Save failed",
};

/**
 * Actionable text for the PRD `PRJ-03` "actionable Save failed" state. Never
 * the repository's raw `SaveFailure.message` — that can carry backend error
 * text not meant for a user-facing surface — and never the reason string
 * itself, which is an internal, unlocalized identifier.
 */
const SAVE_FAILURE_REASON_LABEL: Record<SaveFailureReason, string> = {
	unavailable: "Check your connection.",
	revision_conflict: "This project changed in another tab or session.",
	not_found: "This project no longer exists.",
	already_exists: "A save conflict occurred.",
	unsupported_schema_version:
		"This project needs a newer version of Solid Groove.",
	invalid_document: "Something about this save wasn't valid.",
	document_too_large: "This project is too large to save further changes.",
};

export interface SaveStatusProps {
	readonly saveStatus: Accessor<SaveStatusValue | null>;
	readonly onRetry: () => void;
}

/**
 * The header's save-status readout plus the PRD `PRJ-03` actionable
 * Save-failed alert (retry when retryable, a plain reason otherwise). Split
 * out of `EditorHeader` because it is fully self-contained: everything it
 * needs comes from `saveStatus`.
 */
export default function SaveStatus(props: SaveStatusProps) {
	const saveStatusLabel = () =>
		SAVE_STATUS_LABEL[props.saveStatus()?.state ?? "idle"];
	const saveFailure = () => props.saveStatus()?.failure;
	const saveFailureMessage = () => {
		const failure = saveFailure();
		return failure ? SAVE_FAILURE_REASON_LABEL[failure.reason] : null;
	};

	return (
		<div class="save-status-group">
			<div
				class="save-status"
				data-state={props.saveStatus()?.state}
				data-revision={props.saveStatus()?.revision}
				title={`Revision ${props.saveStatus()?.revision ?? 0}`}
			>
				{saveStatusLabel()}
			</div>
			<Show when={saveFailure()}>
				<div class="save-recovery" role="alert">
					<span class="save-recovery-message">{saveFailureMessage()}</span>
					<Show when={saveFailure()?.retryable}>
						<button
							type="button"
							class="save-retry-button"
							onClick={() => props.onRetry()}
						>
							Retry
						</button>
					</Show>
				</div>
			</Show>
		</div>
	);
}
