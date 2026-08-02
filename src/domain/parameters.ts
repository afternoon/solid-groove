import { z } from "zod";

/**
 * Shared parameter definitions (PRD section 9.5 invariants 4, 10, 11).
 *
 * A parameter declares its range, unit, default, clamping policy, and
 * automation capability exactly once. UI controls, command validation, the
 * audio engine, and assistant tools all read this definition rather than
 * repeating literals.
 *
 * Schema v1 defines only the parameters the `FND-009` vertical slice needs.
 * Per-device instrument and effect parameters are authored with their devices
 * in Alpha Milestone 1, where they can be tuned by ear, and are registered through
 * `defineParameter` at that point.
 */

export type ParameterUnit =
	| "bpm"
	| "decibels"
	| "normalized"
	| "bipolar"
	| "hertz"
	| "seconds"
	| "semitones";

/** How a UI control and the audio engine interpolate across the range. */
export type ParameterScale = "linear" | "logarithmic";

/**
 * What a validated command does with an out-of-range input: `clamp` folds it
 * into range, `reject` refuses the edit. Stored state is always in range
 * either way — the policy only governs coercion of incoming values.
 */
export type ClampPolicy = "clamp" | "reject";

export interface ParameterDefinition {
	readonly id: string;
	readonly label: string;
	readonly unit: ParameterUnit;
	readonly min: number;
	readonly max: number;
	readonly defaultValue: number;
	/** Quantization applied by `coerceParameterValue`, or `null` for continuous. */
	readonly step: number | null;
	readonly scale: ParameterScale;
	readonly clampPolicy: ClampPolicy;
	readonly automatable: boolean;
}

export interface ParameterDefinitionInput {
	id: string;
	label: string;
	unit: ParameterUnit;
	min: number;
	max: number;
	defaultValue: number;
	step?: number | null;
	scale?: ParameterScale;
	clampPolicy?: ClampPolicy;
	automatable: boolean;
}

/** Validates and freezes one parameter definition. */
export function defineParameter(
	input: ParameterDefinitionInput,
): ParameterDefinition {
	const { id, min, max, defaultValue, step = null } = input;
	if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
		throw new TypeError(
			`Parameter "${id}" needs a finite range with min < max, received ${min}..${max}`,
		);
	}
	if (
		!Number.isFinite(defaultValue) ||
		defaultValue < min ||
		defaultValue > max
	) {
		throw new TypeError(
			`Parameter "${id}" default ${defaultValue} is outside its range ${min}..${max}`,
		);
	}
	if (step !== null && (!Number.isFinite(step) || step <= 0)) {
		throw new TypeError(`Parameter "${id}" step must be a positive number`);
	}
	return Object.freeze({
		id,
		label: input.label,
		unit: input.unit,
		min,
		max,
		defaultValue,
		step,
		scale: input.scale ?? "linear",
		clampPolicy: input.clampPolicy ?? "clamp",
		automatable: input.automatable,
	});
}

const definitions = new Map<string, ParameterDefinition>();

function register(input: ParameterDefinitionInput): ParameterDefinition {
	const definition = defineParameter(input);
	if (definitions.has(definition.id)) {
		throw new TypeError(`Parameter "${definition.id}" is already defined`);
	}
	definitions.set(definition.id, definition);
	return definition;
}

export const SONG_TEMPO = register({
	id: "song.tempo",
	label: "Tempo",
	unit: "bpm",
	min: 20,
	max: 300,
	defaultValue: 120,
	automatable: false,
});

export const TRACK_VOLUME = register({
	id: "track.volume",
	label: "Track volume",
	unit: "decibels",
	min: -60,
	max: 6,
	defaultValue: 0,
	automatable: true,
});

export const TRACK_PAN = register({
	id: "track.pan",
	label: "Track pan",
	unit: "bipolar",
	min: -1,
	max: 1,
	defaultValue: 0,
	automatable: true,
});

export const TRACK_SEND_LEVEL = register({
	id: "track.sendLevel",
	label: "Send level",
	unit: "normalized",
	min: 0,
	max: 1,
	defaultValue: 0,
	automatable: true,
});

export const RETURN_VOLUME = register({
	id: "return.volume",
	label: "Return volume",
	unit: "decibels",
	min: -60,
	max: 6,
	defaultValue: 0,
	automatable: true,
});

export const RETURN_PAN = register({
	id: "return.pan",
	label: "Return pan",
	unit: "bipolar",
	min: -1,
	max: 1,
	defaultValue: 0,
	automatable: true,
});

export const MASTER_VOLUME = register({
	id: "master.volume",
	label: "Master volume",
	unit: "decibels",
	min: -60,
	max: 6,
	defaultValue: 0,
	automatable: true,
});

export const NOTE_VELOCITY = register({
	id: "note.velocity",
	label: "Velocity",
	unit: "normalized",
	min: 0,
	max: 1,
	defaultValue: 0.8,
	automatable: false,
});

export const NOTE_PROBABILITY = register({
	id: "note.probability",
	label: "Probability",
	unit: "normalized",
	min: 0,
	max: 1,
	defaultValue: 1,
	automatable: false,
});

/** Every parameter registered so far, keyed by parameter ID. */
export function parameterDefinitions(): ReadonlyMap<
	string,
	ParameterDefinition
> {
	return definitions;
}

export function getParameterDefinition(
	id: string,
): ParameterDefinition | undefined {
	return definitions.get(id);
}

export function requireParameterDefinition(id: string): ParameterDefinition {
	const definition = definitions.get(id);
	if (!definition) {
		throw new TypeError(`Unknown parameter "${id}"`);
	}
	return definition;
}

/** Registers a device or instrument parameter defined by a later phase. */
export function registerParameter(
	input: ParameterDefinitionInput,
): ParameterDefinition {
	return register(input);
}

/** Only registered, automation-capable parameters may carry automation. */
export function isAutomatable(id: string): boolean {
	return definitions.get(id)?.automatable === true;
}

export function isParameterValueInRange(
	definition: ParameterDefinition,
	value: number,
): boolean {
	return (
		Number.isFinite(value) && value >= definition.min && value <= definition.max
	);
}

/** Folds a value into range and onto the definition's step grid. */
export function clampParameterValue(
	definition: ParameterDefinition,
	value: number,
): number {
	if (!Number.isFinite(value)) {
		throw new TypeError(
			`Parameter "${definition.id}" cannot take a non-finite value`,
		);
	}
	const bounded = Math.min(definition.max, Math.max(definition.min, value));
	if (definition.step === null) {
		return bounded;
	}
	const stepped =
		definition.min +
		Math.round((bounded - definition.min) / definition.step) * definition.step;
	return Math.min(definition.max, Math.max(definition.min, roundStep(stepped)));
}

function roundStep(value: number): number {
	// Guards against step arithmetic producing 0.30000000000000004-style noise.
	return Number(value.toFixed(9));
}

export type ParameterCoercion =
	| { ok: true; value: number }
	| { ok: false; reason: string };

/**
 * Applies a raw input value according to the definition's clamping policy.
 * Command validation calls this; stored state is always already in range.
 */
export function coerceParameterValue(
	definition: ParameterDefinition,
	value: number,
): ParameterCoercion {
	if (!Number.isFinite(value)) {
		return {
			ok: false,
			reason: `Parameter "${definition.id}" requires a finite number`,
		};
	}
	if (
		definition.clampPolicy === "reject" &&
		!isParameterValueInRange(definition, value)
	) {
		return {
			ok: false,
			reason: `Parameter "${definition.id}" must be between ${definition.min} and ${definition.max}`,
		};
	}
	return { ok: true, value: clampParameterValue(definition, value) };
}

/** Runtime schema for a stored value of this parameter. */
export function parameterValueSchema(
	definition: ParameterDefinition,
): z.ZodNumber {
	return z.number().min(definition.min).max(definition.max);
}

/** Runtime schema for the stored value of a registered parameter ID. */
export function parameterSchemaFor(id: string): z.ZodNumber {
	return parameterValueSchema(requireParameterDefinition(id));
}
