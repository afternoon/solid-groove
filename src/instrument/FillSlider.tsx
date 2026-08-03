import { createMemo, type JSX } from "solid-js";
import {
	clampParameterValue,
	type ParameterDefinition,
} from "../domain/parameters";
import "./FillSlider.css";

/**
 * The coordinate space a slider moves in, when that differs from the
 * parameter's own range — a volume fader travels in perceptual `0..1` fader
 * positions while the parameter it writes is decibels.
 */
export interface FillSliderRange {
	readonly min: number;
	readonly max: number;
	readonly step?: number | null;
}

export interface FillSliderProps {
	readonly definition: ParameterDefinition;
	readonly value: number;
	/** Formatted live value shown under the slider (e.g. "760 Hz"). */
	readonly displayValue: string;
	/** Called with a coerced, in-range value while dragging. */
	onInput(value: number): void;
	/** Called once when the drag/keyboard gesture commits. */
	onCommit(value: number): void;
	/**
	 * A unique element id for the input. Required when more than one slider for
	 * the same parameter is on screen — a mixer has one volume fader per track.
	 */
	readonly inputId?: string;
	/** Visible label above the slider. Defaults to the parameter's own label. */
	readonly label?: string;
	/**
	 * Accessible name for the input, when the visible label alone is ambiguous
	 * (a mixer's "VOL" needs to say which track it belongs to).
	 */
	readonly ariaLabel?: string;
	/** The slider's own coordinate space, if not the parameter's range. */
	readonly range?: FillSliderRange;
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
	const id = () => props.inputId ?? defaultInputId(props.definition.id);
	const scale = (): FillSliderRange => props.range ?? props.definition;

	const fillPercent = createMemo(() => {
		const { min, max } = scale();
		const span = max - min;
		if (span <= 0) return 0;
		return ((props.value - min) / span) * 100;
	});

	const coerce = (raw: number): number => {
		const range = props.range;
		if (!range) return clampParameterValue(props.definition, raw);
		if (!Number.isFinite(raw)) return range.min;
		return Math.min(range.max, Math.max(range.min, raw));
	};

	return (
		<div class="fill-slider">
			<label class="fill-slider-label" for={id()}>
				{props.label ?? props.definition.label}
			</label>
			<div class="fill-slider-track">
				<div
					class="fill-slider-fill"
					style={{ height: `${fillPercent()}%` }}
					aria-hidden="true"
				/>
				<input
					id={id()}
					class="fill-slider-input"
					type="range"
					// A vertical orientation for pointer and arrow-key semantics.
					aria-orientation="vertical"
					aria-label={props.ariaLabel}
					// The slider's raw number is meaningless to a screen reader — a
					// fader position, or a bipolar pan. Announce what is painted.
					aria-valuetext={props.displayValue}
					min={scale().min}
					max={scale().max}
					step={scale().step ?? "any"}
					value={props.value}
					onInput={(event) =>
						props.onInput(coerce(event.currentTarget.valueAsNumber))
					}
					onChange={(event) =>
						props.onCommit(coerce(event.currentTarget.valueAsNumber))
					}
				/>
			</div>
			<output class="fill-slider-value" for={id()}>
				{props.displayValue}
			</output>
		</div>
	);
}

function defaultInputId(parameterId: string): string {
	return `fill-slider-${parameterId.replace(/\./g, "-")}`;
}
