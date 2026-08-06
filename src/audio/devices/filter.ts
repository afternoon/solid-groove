import * as Tone from "tone";
import { FILTER_MODES } from "../../domain/devices";
import { type DeviceCore, type DeviceCoreFactory, setOrRamp } from "./types";

/** Resolves a stored `filter.mode` index to its `BiquadFilterNode` type. */
function filterMode(index: number): (typeof FILTER_MODES)[number] {
	const i = Math.min(FILTER_MODES.length - 1, Math.max(0, Math.round(index)));
	return FILTER_MODES[i];
}

/**
 * Filter / EQ: one state-variable biquad in low-pass, high-pass, or band-pass
 * (PRD FX-01).
 *
 * Cutoff and resonance ramp rather than step, so a live sweep — including a
 * self-resonant one at the top of `filter.resonance`'s deliberately generous
 * range (FX-02) — is smooth. Mode is discrete: changing it sets the *existing*
 * biquad's `type`, which is a coefficient swap on one node rather than a new
 * node, so `DeviceChain` never sees a composition change and never relinks.
 */
export const createFilterCore: DeviceCoreFactory = (): DeviceCore => {
	const filter = new Tone.Filter({ type: "lowpass" });
	return {
		input: filter,
		output: filter,
		apply(values, _context, initial) {
			const mode = filterMode(values.mode);
			if (filter.type !== mode) filter.type = mode;
			setOrRamp(filter.frequency, values.cutoff, initial);
			setOrRamp(filter.Q, values.resonance, initial);
		},
		dispose() {
			filter.dispose();
		},
	};
};
