import type { Component } from "solid-js";
import type { Envelope } from "../../model/types";
import { VerticalSlider } from "./VerticalSlider";

interface EnvelopeControlsProps {
	envelope: Envelope;
	onChange: (envelope: Envelope) => void;
}

export const EnvelopeControls: Component<EnvelopeControlsProps> = (props) => {
	return (
		<div class="param-group">
			<div class="param-group-title">Envelope</div>
			<div class="param-group-controls">
				<VerticalSlider
					label="Attack"
					min={0}
					max={2}
					value={props.envelope.attack}
					step={0.01}
					onChange={(attack) => props.onChange({ ...props.envelope, attack })}
				/>
				<VerticalSlider
					label="Decay"
					min={0}
					max={2}
					value={props.envelope.decay}
					step={0.01}
					onChange={(decay) => props.onChange({ ...props.envelope, decay })}
				/>
				<VerticalSlider
					label="Sustain"
					min={0}
					max={1}
					value={props.envelope.sustain}
					step={0.01}
					onChange={(sustain) => props.onChange({ ...props.envelope, sustain })}
				/>
				<VerticalSlider
					label="Release"
					min={0}
					max={5}
					value={props.envelope.release}
					step={0.01}
					onChange={(release) => props.onChange({ ...props.envelope, release })}
				/>
			</div>
		</div>
	);
};
