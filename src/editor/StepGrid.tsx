import { For, type JSX } from "solid-js";
import { analytics } from "../analytics/analytics";
import type { RawCommandInput, TransactionResult } from "../commands";
import { addNotes, removeNotes } from "../commands";
import type { Clip, NoteEvent } from "../domain/entities";
import { createFactoryContext, createNoteEvent } from "../domain/factories";
import { TICKS_PER_SIXTEENTH } from "../domain/time";
import "./StepGrid.css";

const STEP_COUNT = 16;
const KICK_PITCH = 36;

/** Mints note-event IDs for steps the grid creates. A module singleton, not
 * per-render, so two toggles in the same session never collide. */
const factoryContext = createFactoryContext();

export interface StepGridProps {
	readonly clip: Clip;
	dispatch(
		commands: RawCommandInput | readonly RawCommandInput[],
	): TransactionResult | undefined;
}

function noteAtStep(clip: Clip, step: number): NoteEvent | undefined {
	if (clip.content.kind !== "notes") return undefined;
	const startTicks = step * TICKS_PER_SIXTEENTH;
	return clip.content.events.find((event) => event.startTicks === startTicks);
}

/**
 * The `FND-009` slice's surface: a 16-step grid on a sampler track. Each step
 * toggles a note event through the shared command layer — `note.add`/
 * `note.remove` — the same path a keyboard shortcut or the assistant would
 * use, never a direct project mutation (PRD section 9.6).
 */
export default function StepGrid(props: StepGridProps): JSX.Element {
	function toggleStep(step: number): void {
		const existing = noteAtStep(props.clip, step);
		if (existing) {
			props.dispatch(removeNotes(props.clip.id, [existing.id]));
		} else {
			const note = createNoteEvent(factoryContext, {
				startTicks: step * TICKS_PER_SIXTEENTH,
				durationTicks: TICKS_PER_SIXTEENTH,
				pitch: KICK_PITCH,
			});
			props.dispatch(addNotes(props.clip.id, [note]));
		}
		analytics.logFeatureFirstUse("step_editor");
	}

	return (
		<fieldset class="step-grid" aria-label="16-step sequence">
			<For each={Array.from({ length: STEP_COUNT }, (_, index) => index)}>
				{(step) => {
					const active = () => noteAtStep(props.clip, step) !== undefined;
					return (
						<button
							type="button"
							class="step"
							classList={{ active: active(), beat: step % 4 === 0 }}
							aria-pressed={active()}
							aria-label={`Step ${step + 1}${active() ? ", on" : ", off"}`}
							onClick={() => toggleStep(step)}
						>
							<span class="step-number">{step + 1}</span>
						</button>
					);
				}}
			</For>
		</fieldset>
	);
}
