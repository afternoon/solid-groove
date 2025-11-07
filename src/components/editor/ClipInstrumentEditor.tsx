import type { Component } from "solid-js";
import { setSampleTempo, setSampleUrl } from "../../model/project";
import type { ClipInstrument } from "../../model/types";
import { SampleChooser } from "./SampleChooser";
import { VerticalSlider } from "./VerticalSlider";

type ClipInstrumentEditorProps = {
	instrument: ClipInstrument;
	trackIndex: number;
};

export default function ClipInstrumentEditor(
	props: ClipInstrumentEditorProps,
): Component<ClipInstrumentEditorProps> {
	return (
		<div class="clip-instrument-editor">
			<div class="instrument-params">
				<SampleChooser
					sampleUrl={props.instrument.sampleUrl}
					onChange={(sampleUrl) => setSampleUrl(props.trackIndex, sampleUrl)}
				/>
				<div class="param-group">
					<div class="param-group-title">Tempo</div>
					<div class="param-group-controls">
						<VerticalSlider
							label="BPM"
							min={60}
							max={200}
							value={props.instrument.sampleTempo}
							step={1}
							onChange={(sampleTempo) =>
								setSampleTempo(props.trackIndex, sampleTempo)
							}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
