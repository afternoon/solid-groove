import type { Component } from "solid-js";
import "./VerticalSlider.css";

interface VerticalSliderProps {
	label: string;
	min: number;
	max: number;
	value: number;
	step?: number;
	onChange: (value: number) => void;
}

export const VerticalSlider: Component<VerticalSliderProps> = (props) => {
	const handleChange = (e: Event) => {
		const target = e.target as HTMLInputElement;
		props.onChange(Number.parseFloat(target.value));
	};

	const percentage = () =>
		((props.value - props.min) / (props.max - props.min)) * 100;

	return (
		<div class="vertical-slider">
			<div class="slider-track">
				<div class="slider-fill" style={{ height: `${percentage()}%` }} />
				<input
					type="range"
					min={props.min}
					max={props.max}
					step={props.step ?? 0.01}
					value={props.value}
					onInput={handleChange}
				/>
			</div>
			<div class="slider-label">{props.label}</div>
		</div>
	);
};
