import type { Component } from "solid-js";
import {
	setInstrumentEnvelope,
	setInstrumentFilter,
	setOscillatorType,
} from "../../model/project";
import type { SynthInstrument } from "../../model/types";
import { EnvelopeControls } from "./EnvelopeControls";
import { FilterControls } from "./FilterControls";
import { WaveformSelector } from "./WaveformSelector";

type SynthInstrumentEditorProps = {
	instrument: SynthInstrument;
	trackIndex: number;
};

export default function SynthInstrumentEditor(
	props: SynthInstrumentEditorProps,
): Component<SynthInstrumentEditorProps> {
	return (
		<div class="synth-instrument-editor">
			<div class="instrument-params">
				<div class="param-group">
					<div class="param-group-title">Waveform</div>
					<WaveformSelector
						value={props.instrument.oscillatorType}
						onChange={(waveform) =>
							setOscillatorType(props.trackIndex, waveform)
						}
					/>
				</div>
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
