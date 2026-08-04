import type { Device } from "./entities";
import type { DeviceId } from "./ids";
import {
	bareParameterId,
	type ParameterDefinition,
	registerParameter,
} from "./parameters";

/**
 * The device-type registry (PRD FX-01, FX-02, LOOP-008).
 *
 * Schema v1's `Device` shape is generic (id, type, order, bypass, a sparse
 * numeric parameter map). This module is where the alpha's six core device
 * types declare *what* they are: a stable `type` string, the ordered parameter
 * definitions they expose, and the default value of each. Every device
 * parameter is registered through `src/domain/parameters.ts` under a
 * `${type}.${parameterId}` id, exactly the namespace `parse.ts` and the
 * `parameter.set` command already look devices up by — so registering a device
 * here makes its parameters validated, clampable, and settable through the one
 * shared command with no per-device code anywhere else.
 *
 * Ranges are deliberately "extreme but finite" (FX-02): drive, feedback, decay,
 * resonance, and wet/dry reach obviously destructive settings while every bound
 * is a finite number the underlying node stays stable at. A value outside a
 * range is rejected, not silently normalized toward a conservative sound; the
 * only values ever refused are non-finite ones and settings past a bound that
 * would cause runaway resource use or an unsafe output level.
 */

export type DeviceTypeId =
	| "filter"
	| "overdrive"
	| "saturator"
	| "compressor"
	| "delay"
	| "reverb";

export interface DeviceTypeDefinition {
	readonly type: DeviceTypeId;
	readonly label: string;
	/** Parameter definitions in panel order, keyed by their full `type.id`. */
	readonly parameters: readonly ParameterDefinition[];
}

/**
 * Registers one device parameter under the `${type}.${id}` namespace and
 * returns it. Kept local so a device type declares its parameters inline in
 * panel order rather than scattering `registerParameter` calls.
 */
function deviceParameter(
	type: DeviceTypeId,
	input: {
		id: string;
		label: string;
		unit: ParameterDefinition["unit"];
		min: number;
		max: number;
		defaultValue: number;
		step?: number | null;
		scale?: ParameterDefinition["scale"];
		clampPolicy?: ParameterDefinition["clampPolicy"];
		automatable?: boolean;
	},
): ParameterDefinition {
	return registerParameter({
		...input,
		id: `${type}.${input.id}`,
		automatable: input.automatable ?? true,
	});
}

// Wet/dry mix and output trim are common to the mix-affecting devices; a helper
// keeps their range declared once (FX-01: "wet/dry mix and output trim").
function wetParameter(type: DeviceTypeId): ParameterDefinition {
	return deviceParameter(type, {
		id: "wet",
		label: "Dry/Wet",
		unit: "normalized",
		min: 0,
		max: 1,
		defaultValue: 1,
	});
}

function outputTrimParameter(type: DeviceTypeId): ParameterDefinition {
	return deviceParameter(type, {
		id: "output",
		label: "Output",
		unit: "decibels",
		min: -24,
		max: 24,
		defaultValue: 0,
	});
}

// --- Filter / EQ -----------------------------------------------------------

const FILTER_CUTOFF = deviceParameter("filter", {
	id: "cutoff",
	label: "Cutoff",
	unit: "hertz",
	min: 20,
	max: 20_000,
	defaultValue: 1_000,
	scale: "logarithmic",
});
const FILTER_RESONANCE = deviceParameter("filter", {
	id: "resonance",
	label: "Resonance",
	unit: "normalized",
	// A generous but finite Q so the self-resonant sweep is reachable without
	// the filter ringing into an unstable, ear-splitting tone.
	min: 0,
	max: 30,
	defaultValue: 1,
});
const FILTER_MODE = deviceParameter("filter", {
	id: "mode",
	label: "Mode",
	unit: "normalized",
	// 0 low-pass, 1 high-pass, 2 band-pass. Stored as an index (numeric model).
	min: 0,
	max: 2,
	defaultValue: 0,
	step: 1,
	clampPolicy: "reject",
	automatable: false,
});
export const FILTER_MODES = ["lowpass", "highpass", "bandpass"] as const;
export type FilterMode = (typeof FILTER_MODES)[number];

// --- Overdrive -------------------------------------------------------------

const OVERDRIVE_DRIVE = deviceParameter("overdrive", {
	id: "drive",
	label: "Drive",
	unit: "normalized",
	// From clean (0) to obvious destruction (1); the node clips harder as it
	// climbs but the output stays bounded by the master limiter and trim.
	min: 0,
	max: 1,
	defaultValue: 0.3,
});
const OVERDRIVE_TONE = deviceParameter("overdrive", {
	id: "tone",
	label: "Tone",
	unit: "normalized",
	min: 0,
	max: 1,
	defaultValue: 0.5,
});

// --- Saturator -------------------------------------------------------------

const SATURATOR_DRIVE = deviceParameter("saturator", {
	id: "drive",
	label: "Drive",
	unit: "decibels",
	min: 0,
	max: 48,
	defaultValue: 6,
});
const SATURATOR_CHARACTER = deviceParameter("saturator", {
	id: "character",
	label: "Character",
	unit: "normalized",
	min: 0,
	max: 1,
	defaultValue: 0.5,
});

// --- Compressor ------------------------------------------------------------

const COMPRESSOR_THRESHOLD = deviceParameter("compressor", {
	id: "threshold",
	label: "Threshold",
	unit: "decibels",
	min: -60,
	max: 0,
	defaultValue: -24,
});
const COMPRESSOR_RATIO = deviceParameter("compressor", {
	id: "ratio",
	label: "Ratio",
	unit: "normalized",
	// 1:1 (no compression) up to 20:1 (effectively limiting).
	min: 1,
	max: 20,
	defaultValue: 4,
});
const COMPRESSOR_ATTACK = deviceParameter("compressor", {
	id: "attack",
	label: "Attack",
	unit: "seconds",
	min: 0,
	max: 1,
	defaultValue: 0.003,
	scale: "logarithmic",
});
const COMPRESSOR_RELEASE = deviceParameter("compressor", {
	id: "release",
	label: "Release",
	unit: "seconds",
	min: 0.01,
	max: 2,
	defaultValue: 0.25,
	scale: "logarithmic",
});
const COMPRESSOR_MAKEUP = deviceParameter("compressor", {
	id: "makeup",
	label: "Makeup",
	unit: "decibels",
	min: 0,
	max: 24,
	defaultValue: 0,
});

// --- Delay -----------------------------------------------------------------

const DELAY_TIME = deviceParameter("delay", {
	id: "time",
	label: "Time",
	unit: "seconds",
	min: 0.001,
	max: 2,
	defaultValue: 0.25,
	scale: "logarithmic",
});
const DELAY_FEEDBACK = deviceParameter("delay", {
	id: "feedback",
	label: "Feedback",
	unit: "normalized",
	// Capped just below unity: 0.99 is a long, near-infinite tail, but a value
	// of 1 (or above) is unbounded self-reinforcing feedback. `reject` (not the
	// default `clamp`) so such a value is refused outright rather than quietly
	// folded to 0.99 — the one place a device parameter must not silently
	// normalize an unsafe setting (FX-02).
	min: 0,
	max: 0.99,
	defaultValue: 0.4,
	clampPolicy: "reject",
});
const DELAY_FILTER = deviceParameter("delay", {
	id: "filter",
	label: "Filter",
	unit: "hertz",
	min: 20,
	max: 20_000,
	defaultValue: 8_000,
	scale: "logarithmic",
});

// --- Reverb ----------------------------------------------------------------

const REVERB_DECAY = deviceParameter("reverb", {
	id: "decay",
	label: "Decay",
	unit: "seconds",
	min: 0.1,
	max: 30,
	defaultValue: 2.5,
	scale: "logarithmic",
});
const REVERB_PREDELAY = deviceParameter("reverb", {
	id: "predelay",
	label: "Pre-delay",
	unit: "seconds",
	min: 0,
	max: 0.5,
	defaultValue: 0.01,
});
const REVERB_FILTER = deviceParameter("reverb", {
	id: "filter",
	label: "Filter",
	unit: "hertz",
	min: 20,
	max: 20_000,
	defaultValue: 6_000,
	scale: "logarithmic",
});

const DEVICE_TYPES: readonly DeviceTypeDefinition[] = [
	{
		type: "filter",
		label: "Filter",
		parameters: [
			FILTER_CUTOFF,
			FILTER_RESONANCE,
			FILTER_MODE,
			wetParameter("filter"),
		],
	},
	{
		type: "overdrive",
		label: "Overdrive",
		parameters: [
			OVERDRIVE_DRIVE,
			OVERDRIVE_TONE,
			wetParameter("overdrive"),
			outputTrimParameter("overdrive"),
		],
	},
	{
		type: "saturator",
		label: "Saturator",
		parameters: [
			SATURATOR_DRIVE,
			SATURATOR_CHARACTER,
			wetParameter("saturator"),
			outputTrimParameter("saturator"),
		],
	},
	{
		type: "compressor",
		label: "Compressor",
		parameters: [
			COMPRESSOR_THRESHOLD,
			COMPRESSOR_RATIO,
			COMPRESSOR_ATTACK,
			COMPRESSOR_RELEASE,
			COMPRESSOR_MAKEUP,
		],
	},
	{
		type: "delay",
		label: "Delay",
		parameters: [
			DELAY_TIME,
			DELAY_FEEDBACK,
			DELAY_FILTER,
			wetParameter("delay"),
			outputTrimParameter("delay"),
		],
	},
	{
		type: "reverb",
		label: "Reverb",
		parameters: [
			REVERB_DECAY,
			REVERB_PREDELAY,
			REVERB_FILTER,
			wetParameter("reverb"),
			outputTrimParameter("reverb"),
		],
	},
];

const DEVICE_TYPES_BY_ID = new Map<string, DeviceTypeDefinition>(
	DEVICE_TYPES.map((definition) => [definition.type, definition]),
);

/** Every registered device type, in palette order. */
export function deviceTypes(): readonly DeviceTypeDefinition[] {
	return DEVICE_TYPES;
}

/** The definition for a device `type`, or `undefined` if it is not registered. */
export function deviceTypeDefinition(
	type: string,
): DeviceTypeDefinition | undefined {
	return DEVICE_TYPES_BY_ID.get(type);
}

export function isRegisteredDeviceType(type: string): type is DeviceTypeId {
	return DEVICE_TYPES_BY_ID.has(type);
}

/** The parameter definitions a device of `type` owns, or `[]` if unregistered. */
export function deviceParameters(type: string): readonly ParameterDefinition[] {
	return DEVICE_TYPES_BY_ID.get(type)?.parameters ?? [];
}

/**
 * The default parameter map for a device of `type`, keyed by the bare
 * parameter id (the same sparse-map key `Device.parameters` stores). Returns an
 * empty map for an unregistered type so a device the domain does not know can
 * still round-trip.
 */
export function defaultDeviceParameters(type: string): Record<string, number> {
	const parameters: Record<string, number> = {};
	for (const definition of deviceParameters(type)) {
		parameters[bareParameterId(definition.id)] = definition.defaultValue;
	}
	return parameters;
}

/** Builds a fully-defaulted, unbypassed device of `type` at chain position `order`. */
export function createDevice(
	id: DeviceId,
	type: DeviceTypeId,
	order: number,
): Device {
	return {
		id,
		type,
		order,
		bypassed: false,
		parameters: defaultDeviceParameters(type),
		preset: null,
	};
}
