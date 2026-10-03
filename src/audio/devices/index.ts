import type { Device } from "../../domain/entities";
import type { DeviceNode, DeviceNodeFactory } from "../DeviceChain";
import { type DeclaredLatency, NO_LATENCY } from "../latency";
import { compressorLatencyFrames, createCompressorCore } from "./compressor";
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
 * One device type's DSP: its core, and how many frames that core delays the
 * signal by. Latency is declared, never measured (#883), and every entry has
 * to declare it, so a new device cannot silently skip delay compensation.
 */
interface DeviceCoreEntry {
  readonly createCore: DeviceCoreFactory;
  readonly latencyFrames: DeclaredLatency;
}

/**
 * The alpha's six core processing devices, keyed by the `type` string
 * `src/domain/devices.ts` registers them under (PRD FX-01). This map is the one
 * place a `device.type` becomes real DSP; adding a seventh device is a new core
 * module plus one entry here.
 *
 * Only the compressor looks ahead. The filters are IIR biquads, the shapers
 * run without oversampling, and the delay's and reverb's time *is* the effect,
 * so none of them delays the signal it passes.
 */
const DEVICE_CORES: Readonly<Record<string, DeviceCoreEntry>> = {
  filter: { createCore: createFilterCore, latencyFrames: NO_LATENCY },
  overdrive: { createCore: createOverdriveCore, latencyFrames: NO_LATENCY },
  saturator: { createCore: createSaturatorCore, latencyFrames: NO_LATENCY },
  compressor: {
    createCore: createCompressorCore,
    latencyFrames: compressorLatencyFrames,
  },
  delay: { createCore: createDelayCore, latencyFrames: NO_LATENCY },
  reverb: { createCore: createReverbCore, latencyFrames: NO_LATENCY },
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
export function createDeviceNodeFactory(context: DeviceGraphContext): DeviceNodeFactory {
  return (device: Device): DeviceNode | undefined => {
    const entry = DEVICE_CORES[device.type];
    if (!entry) return undefined;
    return buildDeviceNode(device, context, entry.createCore);
  };
}

/**
 * How many frames a device of `type` delays its signal by, at `sampleRate`.
 * An unknown type is the chain's inert passthrough, which delays nothing.
 */
export function deviceLatencyFrames(type: string, sampleRate: number): number {
  return Object.hasOwn(DEVICE_CORES, type)
    ? DEVICE_CORES[type].latencyFrames(sampleRate)
    : 0;
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
