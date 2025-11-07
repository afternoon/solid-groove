import type { Component } from "solid-js";
import {
	setInstrumentEnvelope,
	setInstrumentFilter,
	setSampleUrl,
} from "../../model/project";
import type { SamplerInstrument } from "../../model/types";
import { EnvelopeControls } from "./EnvelopeControls";
import { FilterControls } from "./FilterControls";
import { SampleChooser } from "./SampleChooser";

type SamplerInstrumentEditorProps = {
	instrument: SamplerInstrument;
	trackIndex: number;
};

export default function SamplerInstrumentEditor(
	props: SamplerInstrumentEditorProps,
): Component<SamplerInstrumentEditorProps> {
	return (
		<div class="sampler-instrument-editor">
			<div class="instrument-params">
				<SampleChooser
					sampleUrl={props.instrument.sampleUrl}
					onChange={(sampleUrl) => setSampleUrl(props.trackIndex, sampleUrl)}
				/>
				<EnvelopeControls
					envelope={props.instrument.envelope}
					onChange={(envelope) =>
						setInstrumentEnvelope(props.trackIndex, envelope)
					}
				/>
				<FilterControls
					filter={props.instrument.filter}
					onChange={(filter) => setInstrumentFilter(props.trackIndex, filter)}
				/>
			</div>
		</div>
	);
}
