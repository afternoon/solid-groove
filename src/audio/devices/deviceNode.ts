import * as Tone from "tone";
import { deviceParameters } from "../../domain/devices";
import type { Device } from "../../domain/entities";
import type { DeviceNode } from "../DeviceChain";
import {
	type DeviceCoreFactory,
	type DeviceGraphContext,
	readDeviceParameters,
	setOrRamp,
} from "./types";

/**
 * Wraps a device's DSP core in the mix stage every device shares (FX-01:
 * "Applicable devices include wet/dry mix and output trim"; "A device can be
 * ... bypassed"):
 *
 * `input` fans out to an always-connected dry leg and a wet leg through the
 * core; both meet at a trim stage feeding `output`.
 *
 * Bypass and wet/dry are both expressed as gains on those two legs, never as a
 * reconnection. That makes bypass click-free and, more importantly, keeps a
 * bypassed device's core *alive*: a delay's repeats and a reverb's tail keep
 * ringing into a muted wet leg, so un-bypassing mid-tail does not restart the
 * effect from silence (FX-01 tails). It also means neither bypass nor a
 * parameter edit ever replaces a node, so `DeviceChain` never relinks for one.
 *
 * A device declaring no `wet` parameter (the plain filter) runs fully wet; its
 * dry leg stays at zero and costs nothing.
 */
export function buildDeviceNode(
	device: Device,
	context: DeviceGraphContext,
	createCore: DeviceCoreFactory,
): DeviceNode {
	const definitions = deviceParameters(device.type);
	const hasWet = definitions.some((d) => d.id.endsWith(".wet"));
	const hasOutput = definitions.some((d) => d.id.endsWith(".output"));

	const input = new Tone.Gain(1);
	const dry = new Tone.Gain(0);
	const wet = new Tone.Gain(1);
	const output = new Tone.Gain(1);
	const trim = new Tone.Volume(0);

	const core = createCore(device, context);

	input.connect(dry);
	input.connect(core.input);
	core.output.connect(wet);
	dry.connect(trim);
	wet.connect(trim);
	trim.connect(output);

	/**
	 * Bypass is *not* a separate switch layered over the mix: it is the same two
	 * gains, driven to a full-dry split. Modelling it this way means a device
	 * cannot end up bypassed and wet at once, and an un-bypass restores exactly
	 * the stored mix.
	 */
	function applyMix(
		next: Device,
		values: Readonly<Record<string, number>>,
		initial: boolean,
	) {
		const mix = next.bypassed ? 0 : hasWet ? values.wet : 1;
		setOrRamp(wet.gain, mix, initial);
		setOrRamp(dry.gain, 1 - mix, initial);
		// Output trim follows bypass too, so a bypassed device is truly inert
		// rather than a hidden gain stage.
		setOrRamp(
			trim.volume,
			next.bypassed || !hasOutput ? 0 : values.output,
			initial,
		);
	}

	const initialValues = readDeviceParameters(definitions, device);
	core.apply(initialValues, context, true);
	applyMix(device, initialValues, true);

	return {
		id: device.id,
		type: device.type,
		input,
		output,
		update(next) {
			const values = readDeviceParameters(definitions, next);
			core.apply(values, context, false);
			applyMix(next, values, false);
		},
		dispose() {
			core.dispose();
			input.dispose();
			dry.dispose();
			wet.dispose();
			trim.dispose();
			output.dispose();
		},
		gainReductionDb: core.gainReductionDb?.bind(core),
		resolvedDelaySeconds: core.resolvedDelaySeconds?.bind(core),
		ready: core.ready?.bind(core),
	};
}
