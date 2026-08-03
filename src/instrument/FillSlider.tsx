import { createMemo, type JSX } from "solid-js";
import {
	clampParameterValue,
	type ParameterDefinition,
} from "../domain/parameters";
import "./FillSlider.css";

export interface FillSliderProps {
	readonly definition: ParameterDefinition;
	readonly value: number;
	/** Formatted live value shown under the slider (e.g. "760 Hz"). */
	readonly displayValue: string;
	/** Called with a coerced, in-range value while dragging. */
	onInput(value: number): void;
	/** Called once when the drag/keyboard gesture commits. */
	onCommit(value: number): void;
}

/**
 * The one continuous control (design mock `06c-slider`): a thumbless vertical
 * fill track with its label above and live value below. The filled portion *is*
 * the value; dragging up/down maps directly onto the fill.
 *
 * It is a real `<input type="range">` underneath — so it is keyboard-operable
 * and screen-reader labelled for free — visually restyled to a fill track. The
 * range's own `step` follows the parameter definition, so a stepped parameter
 * (pitch in semitones, waveform index) snaps and a continuous one (cutoff) does
 * not.
 *
 * `onInput` fires per movement so the audio graph can follow live; `onCommit`
 * fires once when the gesture ends, which is where the caller opens/closes a
 * single history gesture so a drag is one undo step and emits nothing per tick.
 */
export default function FillSlider(props: FillSliderProps): JSX.Element {
	const fillPercent = createMemo(() => {
		const { min, max } = props.definition;
		const span = max - min;
		if (span <= 0) return 0;
		return ((props.value - min) / span) * 100;
	});

	const coerce = (raw: number): number =>
		clampParameterValue(props.definition, raw);

	return (
		<div class="fill-slider">
			<label class="fill-slider-label" for={inputId(props.definition.id)}>
				{props.definition.label}
			</label>
			<div class="fill-slider-track">
				<div
					class="fill-slider-fill"
					style={{ height: `${fillPercent()}%` }}
					aria-hidden="true"
				/>
				<input
					id={inputId(props.definition.id)}
					class="fill-slider-input"
					type="range"
					// A vertical orientation for pointer and arrow-key semantics.
					aria-orientation="vertical"
					min={props.definition.min}
					max={props.definition.max}
					step={props.definition.step ?? "any"}
					value={props.value}
					onInput={(event) =>
						props.onInput(coerce(event.currentTarget.valueAsNumber))
					}
					onChange={(event) =>
						props.onCommit(coerce(event.currentTarget.valueAsNumber))
					}
				/>
			</div>
			<output class="fill-slider-value" for={inputId(props.definition.id)}>
				{props.displayValue}
			</output>
		</div>
	);
}

function inputId(parameterId: string): string {
	return `fill-slider-${parameterId.replace(/\./g, "-")}`;
}
