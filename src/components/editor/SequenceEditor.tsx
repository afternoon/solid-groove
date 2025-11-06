import type { Component } from "solid-js";
import type { Sequence } from "../../model/types";

type SequenceEditorProps = {
	sequence: Sequence;
	trackIndex: number;
};

export default function SequenceEditor(
	props: SequenceEditorProps,
): Component<SequenceEditorProps> {
	return (
		<div class="sequence-editor">
			{/* Step sequencer UI will go here */}
			{/* Will display {props.sequence.steps.length} steps */}
		</div>
	);
}
