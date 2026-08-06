import * as Tone from "tone";
import {
	type DeviceCore,
	type DeviceCoreFactory,
	type RampableParam,
	setOrRamp,
} from "./types";

/**
 * How far below a ceiling of exactly 0 {@link applyParam} keeps a value. A
 * millionth of a decibel is not a different threshold to any ear or any meter;
 * it exists only to keep the value off the one number Tone treats specially.
 */
const ZERO_CEILING_EPSILON = 1e-6;

/**
 * Applies one `DynamicsCompressorNode` param through the shared
 * {@link setOrRamp}, first clamping into the range the node itself accepts.
 *
 * The clamp is this device's own concern: the registered ranges sit inside the
 * node's, but a stored value from a future range change must not reach it out
 * of bounds.
 *
 * Zero gets clamped away from a ceiling of 0 for a narrower reason. Tone's
 * ramps refuse to *start* from exactly zero — `Param.setRampPoint` pins the
 * param's current value and substitutes its `_minOutput` (1e-7) for a zero,
 * because an exponential ramp can never leave zero. For the threshold, whose
 * accepted range tops out at 0 dB, that substituted 1e-7 is itself out of
 * range, so a value of 0 dB applies fine and then throws `RangeError` on the
 * *next* edit that ramps away from it. Since 0 dB is the legitimate top of the
 * registered range ("do not compress"), the fix is to never store the literal
 * zero: -1e-6 dB behaves identically and every later ramp stays in range.
 */
function applyParam(
	param: RampableParam & {
		readonly minValue: number;
		readonly maxValue: number;
	},
	value: number,
	initial: boolean,
): void {
	const ceiling = param.maxValue === 0 ? -ZERO_CEILING_EPSILON : param.maxValue;
	setOrRamp(param, Math.min(ceiling, Math.max(param.minValue, value)), initial);
}

/**
 * Compressor: threshold, ratio, attack, release, and makeup gain, with a live
 * gain-reduction read for metering (PRD FX-01).
 *
 * Every control maps onto the one `Tone.Compressor` (a `DynamicsCompressorNode`
 * underneath), so a parameter edit is an `AudioParam` change, never a node
 * rebuild. Makeup is a separate gain stage after it rather than a compressor
 * setting, because `DynamicsCompressorNode` has none — folding it into the
 * threshold instead would silently change how hard the device compresses.
 *
 * Parallel ("New York") compression comes from the shared wet/dry stage in
 * `deviceNode.ts`, not from anything here.
 */
export const createCompressorCore: DeviceCoreFactory = (): DeviceCore => {
	const compressor = new Tone.Compressor();
	const makeup = new Tone.Volume(0);
	compressor.connect(makeup);

	return {
		input: compressor,
		output: makeup,
		apply(values, _context, initial) {
			// `knee` is not exposed as a control: FX-01 lists five compressor
			// parameters and a sixth would be a knob without a stated purpose. A
			// fixed moderate knee keeps low ratios musical rather than abrupt.
			applyParam(compressor.knee, 6, initial);
			applyParam(compressor.threshold, values.threshold, initial);
			applyParam(compressor.ratio, values.ratio, initial);
			applyParam(compressor.attack, values.attack, initial);
			applyParam(compressor.release, values.release, initial);
			applyParam(makeup.volume, values.makeup, initial);
		},
		/**
		 * The node's own `reduction`, in dB: 0 when the compressor is not working
		 * and increasingly negative as it clamps down. Returned as a *positive*
		 * magnitude, which is how a gain-reduction meter reads, and polled by the
		 * panel — never pushed as an analytics event, so metering adds no
		 * per-frame telemetry.
		 */
		gainReductionDb() {
			return Math.abs(compressor.reduction);
		},
		dispose() {
			compressor.dispose();
			makeup.dispose();
		},
	};
};
