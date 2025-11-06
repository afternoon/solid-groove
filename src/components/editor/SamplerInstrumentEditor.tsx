import type { Component } from "solid-js";
import type { SamplerInstrument } from "../../model/types";

type SamplerInstrumentEditorProps = {
	instrument: SamplerInstrument;
	trackIndex: number;
};

export default function SamplerInstrumentEditor(
	props: SamplerInstrumentEditorProps,
): Component<SamplerInstrumentEditorProps> {
	return (
		<div class="sampler-instrument-editor">
			{/* Sampler controls will go here */}
			{/* Sample URL: {props.instrument.sampleUrl} */}
			{/* Envelope controls */}
			{/* Filter controls */}
		</div>
	);
}
