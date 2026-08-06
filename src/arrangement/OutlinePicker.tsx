import { createSignal, For, Show } from "solid-js";
import type { OutlineMode } from "./arrangementOutline";
import { describeOutline } from "./arrangementOutline";
import { OUTLINE_TEMPLATES, type OutlineTemplate } from "./outlineTemplates";

/**
 * ARR-03's loop-to-song affordance: pick a structure template and a copy mode,
 * then build an outline from the selected loop range.
 *
 * Split out of `SectionPanel` because it is a *different* decision from editing
 * an existing section — this one is the "turn my loop into a song" moment, and
 * it is the only place a producer is asked linked-vs-independent before an
 * arrangement exists.
 *
 * The copy-mode sentence comes from `describeOutline`, i.e. from the same
 * module that performs the operation, so CLP-01's "the UI states which
 * operation will occur" cannot drift from what actually happens. Nothing here
 * logs analytics or touches a project: it calls `onCreate` with the two
 * choices, and the section controller does the rest.
 */

export interface OutlinePickerProps {
	readonly onCreate: (template: OutlineTemplate, mode: OutlineMode) => void;
	/** Whether a loop range is selected, so the action can run at all. */
	readonly hasLoopRange: boolean;
	/** Set when the last attempt was refused, so the user is told why. */
	readonly message?: string | null;
}

export function OutlinePicker(props: OutlinePickerProps) {
	const [templateId, setTemplateId] = createSignal(OUTLINE_TEMPLATES[0].id);
	const [mode, setMode] = createSignal<OutlineMode>("linked");

	const template = () =>
		OUTLINE_TEMPLATES.find((entry) => entry.id === templateId()) ??
		OUTLINE_TEMPLATES[0];

	return (
		<div class="section-panel-outline" data-testid="outline-picker">
			<h3 class="section-panel-subtitle">Build an outline from the loop</h3>

			<label class="section-panel-field">
				<span>Structure</span>
				<select
					data-action="outline-template"
					value={templateId()}
					onChange={(event) =>
						setTemplateId(event.currentTarget.value as OutlineTemplate["id"])
					}
				>
					<For each={OUTLINE_TEMPLATES}>
						{(entry) => <option value={entry.id}>{entry.label}</option>}
					</For>
				</select>
			</label>
			<p class="section-panel-hint">{template().description}</p>

			<label class="section-panel-field">
				<span>Copies</span>
				<select
					data-action="outline-mode"
					value={mode()}
					onChange={(event) =>
						setMode(event.currentTarget.value as OutlineMode)
					}
				>
					<option value="linked">Linked</option>
					<option value="independent">Independent</option>
				</select>
			</label>
			{/* Generated from the same mode the action takes (CLP-01/ARR-03). */}
			<p class="section-panel-hint" data-testid="outline-mode-description">
				{describeOutline(mode())}
			</p>

			<button
				type="button"
				class="arrangement-action"
				data-action="create-outline"
				disabled={!props.hasLoopRange}
				title={describeOutline(mode())}
				onClick={() => props.onCreate(template(), mode())}
			>
				Create outline
			</button>

			<Show when={!props.hasLoopRange}>
				<p class="section-panel-hint">
					Select a loop range in the arrangement first.
				</p>
			</Show>
			<Show when={props.message}>
				{(message) => <output class="section-panel-error">{message()}</output>}
			</Show>
		</div>
	);
}
