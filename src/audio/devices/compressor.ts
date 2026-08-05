import * as Tone from "tone";
import {
	type DeviceCore,
	type DeviceCoreFactory,
	type RampableParam,
	setOrRamp,
} from "./types";

/**
 * Applies one `DynamicsCompressorNode` param through the shared
 * {@link setOrRamp}, first clamping into the range the node itself accepts.
 *
 * The clamp is this device's own concern: the registered ranges sit inside the
 * node's, but a stored value from a future range change must not reach it out
 * of bounds. `setOrRamp` also guarantees a *linear* ramp, which matters
 * specifically here — Tone picks an exponential curve for a decibel param, and
 * an exponential ramp cannot reach 0, so a threshold of 0 dB (the legitimate
 * top of the registered range, meaning "do not compress") threw `RangeError`
 * rather than applying.
 */
function applyParam(
	param: RampableParam & {
		readonly minValue: number;
		readonly maxValue: number;
	},
	value: number,
	initial: boolean,
): void {
	setOrRamp(
		param,
		Math.min(param.maxValue, Math.max(param.minValue, value)),
		initial,
	);
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
