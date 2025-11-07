import { type Component, For } from "solid-js";
import { setSequenceStep } from "../../model/project";
import type { Sequence } from "../../model/types";
import "./SequenceEditor.css";

type SequenceEditorProps = {
	sequence: Sequence;
	trackIndex: number;
};

export default function SequenceEditor(
	props: SequenceEditorProps,
): Component<SequenceEditorProps> {
	const handleStepToggle = (stepIndex: number) => {
		const currentNote = props.sequence.steps[stepIndex];
		const newNote = currentNote === null ? "C3" : null;
		// Currently hardcoded to pattern 0, as seen in Editor.tsx
		setSequenceStep(0, props.trackIndex, stepIndex, newNote);
	};

	return (
		<div class="sequence-editor">
			<For each={props.sequence.steps}>
				{(note, index) => (
					<button
						type="button"
						class="step"
						classList={{ active: note !== null }}
						onClick={() => handleStepToggle(index())}
						aria-label={`Step ${index() + 1}${note ? ` - ${note}` : ""}`}
					>
						<span class="step-number">{index() + 1}</span>
					</button>
				)}
			</For>
		</div>
	);
}
