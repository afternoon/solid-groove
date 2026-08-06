import type { Device } from "../../domain/entities";
import type { DeviceNode, DeviceNodeFactory } from "../DeviceChain";
import { createCompressorCore } from "./compressor";
import { createDelayCore } from "./delay";
import { buildDeviceNode } from "./deviceNode";
import { createOverdriveCore, createSaturatorCore } from "./distortion";
import { createFilterCore } from "./filter";
import { createReverbCore } from "./reverb";
import type { DeviceCoreFactory, DeviceGraphContext } from "./types";

export { buildDeviceNode } from "./deviceNode";
export type { DeviceCore, DeviceGraphContext } from "./types";
export { DEVICE_SMOOTHING_SECONDS, setOrRamp } from "./types";

/**
 * The alpha's six core processing devices, keyed by the `type` string
 * `src/domain/devices.ts` registers them under (PRD FX-01). This map is the one
 * place a `device.type` becomes real DSP; adding a seventh device is a new core
 * module plus one entry here.
 */
const DEVICE_CORES: Readonly<Record<string, DeviceCoreFactory>> = {
	filter: createFilterCore,
	overdrive: createOverdriveCore,
	saturator: createSaturatorCore,
	compressor: createCompressorCore,
	delay: createDelayCore,
	reverb: createReverbCore,
};

/**
 * Builds the {@link DeviceNodeFactory} `DeviceChain` uses, given a way to read
 * the song's current tempo (which only the tempo-syncable delay consults).
 *
 * A `device.type` with no registered core returns `undefined`, which leaves
 * `DeviceChain` to fall back to its inert passthrough. That is deliberate: an
 * unknown type — a project saved by a future build, say — must still load and
 * play the rest of the chain rather than failing to build the graph at all.
 */
export function createDeviceNodeFactory(
	context: DeviceGraphContext,
): DeviceNodeFactory {
	return (device: Device): DeviceNode | undefined => {
		const createCore = DEVICE_CORES[device.type];
		if (!createCore) return undefined;
		return buildDeviceNode(device, context, createCore);
	};
}

/** Whether a `device.type` has real DSP behind it, rather than a passthrough. */
export function hasDeviceCore(type: string): boolean {
	return type in DEVICE_CORES;
}

/** Every `device.type` with a registered core. Lets a test prove this map and
 * the domain's device-type registry have not drifted apart in either direction. */
export function registeredDeviceCoreTypes(): readonly string[] {
	return Object.keys(DEVICE_CORES);
}
