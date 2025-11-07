import { FiTriangle } from "solid-icons/fi";
import { TbWaveSawTool, TbWaveSine, TbWaveSquare } from "solid-icons/tb";
import type { Component } from "solid-js";

interface WaveformSelectorProps {
	value: "sine" | "square" | "sawtooth" | "triangle";
	onChange: (waveform: "sine" | "square" | "sawtooth" | "triangle") => void;
}

export const WaveformSelector: Component<WaveformSelectorProps> = (props) => {
	const waveforms: {
		type: "sine" | "square" | "sawtooth" | "triangle";
		label: string;
		icon: Component;
	}[] = [
		{ type: "sine", label: "Sine", icon: TbWaveSine },
		{ type: "square", label: "Square", icon: TbWaveSquare },
		{ type: "sawtooth", label: "Sawtooth", icon: TbWaveSawTool },
		{ type: "triangle", label: "Triangle", icon: FiTriangle },
	];

	return (
		<div class="waveform-selector">
			{waveforms.map((waveform) => (
				<label class="waveform-option">
					<input
						type="radio"
						name="waveform"
						value={waveform.type}
						checked={props.value === waveform.type}
						onChange={() => props.onChange(waveform.type)}
					/>
					<span class="waveform-icon">
						{waveform.icon({})}
						{waveform.label}
					</span>
				</label>
			))}
		</div>
	);
};
