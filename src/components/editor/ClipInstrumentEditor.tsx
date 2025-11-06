import type { Component } from "solid-js";
import type { ClipInstrument } from "../../model/types";

type ClipInstrumentEditorProps = {
	instrument: ClipInstrument;
	trackIndex: number;
};

export default function ClipInstrumentEditor(
	props: ClipInstrumentEditorProps,
): Component<ClipInstrumentEditorProps> {
	return (
		<div class="clip-instrument-editor">
			{/* Clip instrument controls will go here */}
			{/* Sample URL: {props.instrument.sampleUrl} */}
			{/* Sample tempo: {props.instrument.sampleTempo} */}
		</div>
	);
}
