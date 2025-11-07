import { type Component, createSignal } from "solid-js";

interface VerticalSliderProps {
	label: string;
	min: number;
	max: number;
	value: number;
	step?: number;
	onChange: (value: number) => void;
}

export const VerticalSlider: Component<VerticalSliderProps> = (props) => {
	const [value, setValue] = createSignal(props.value);

	const handleChange = (e: Event) => {
		const target = e.target as HTMLInputElement;
		const newValue = Number.parseFloat(target.value);
		setValue(newValue);
		props.onChange(newValue);
	};

	const percentage = () =>
		((value() - props.min) / (props.max - props.min)) * 100;

	return (
		<div class="vertical-slider">
			<div class="slider-track">
				<div class="slider-fill" style={{ height: `${percentage()}%` }} />
				<input
					type="range"
					min={props.min}
					max={props.max}
					step={props.step ?? 0.01}
					value={value()}
					onInput={handleChange}
					orient="vertical"
				/>
			</div>
			<div class="slider-label">{props.label}</div>
		</div>
	);
};
