import type { Component } from "solid-js";
import type { SynthInstrument } from "../../model/types";

type SynthInstrumentEditorProps = {
	instrument: SynthInstrument;
	trackIndex: number;
};

export default function SynthInstrumentEditor(
	props: SynthInstrumentEditorProps,
): Component<SynthInstrumentEditorProps> {
	return (
		<div class="synth-instrument-editor">
			{/* Synth controls will go here */}
			{/* Oscillator type: {props.instrument.oscillatorType} */}
			{/* Envelope controls */}
			{/* Filter controls */}
		</div>
	);
}
