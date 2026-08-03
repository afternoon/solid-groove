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

/**
 * Per-pad drum-machine parameters (PRD INS-01, LOOP-005).
 *
 * A pad's level and pan reuse the track volume/pan definitions (the mixer field
 * carries them), so only pitch and the amp envelope are new here. Pitch is
 * automatable playback transposition; the envelope stages are not automatable in
 * the alpha (they reshape the amp curve of each short-lived voice, not a
 * continuously-drawn lane).
 */
export const PAD_PITCH = register({
	id: "pad.pitch",
	label: "Pad pitch",
	unit: "semitones",
	min: -24,
	max: 24,
	defaultValue: 0,
	step: 1,
	clampPolicy: "clamp",
	automatable: false,
});

export const PAD_ATTACK = register({
	id: "pad.attack",
	label: "Pad attack",
	unit: "seconds",
	min: 0,
	max: 2,
	defaultValue: 0.001,
	scale: "logarithmic",
	clampPolicy: "clamp",
	automatable: false,
});

export const PAD_DECAY = register({
	id: "pad.decay",
	label: "Pad decay",
	unit: "seconds",
	min: 0.01,
	max: 8,
	defaultValue: 8,
	scale: "logarithmic",
	clampPolicy: "clamp",
	automatable: false,
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

// --- Instrument parameters (LOOP-004, PRD INS-01) --------------------------
//
// Synth and one-shot sampler parameters. Registered here (not repeated at the
// UI, command, or audio layers) so a control, its validation, and the audio
// engine all read one definition. Namespaced by instrument kind — `synth.*`
// and `sampler.*` — the same way device parameters are namespaced by device
// type, so `parse.ts` and the `parameter.set` command look them up by
// `${instrument.kind}.${parameterId}`.
//
// The fuller instrument in the design mocks (sub-oscillator, pulse-width,
// multi-mode filter, key tracking, fine tune, gain/pan, envelope hold, a
// per-sampler filter) is the INS-01 *deferred* set (P1/P2) and is not
// registered here.

/**
 * Oscillator waveform, stored as a small integer index rather than a string so
 * it fits the numeric-only parameter model. `SYNTH_WAVEFORMS` maps the index to
 * the Tone oscillator type; the option group in the UI reads the same list.
 */
export const SYNTH_WAVEFORMS = [
	"sine",
	"square",
	"sawtooth",
	"triangle",
] as const;
export type SynthWaveform = (typeof SYNTH_WAVEFORMS)[number];

export const SYNTH_WAVEFORM = register({
	id: "synth.waveform",
	label: "Waveform",
	unit: "normalized",
	min: 0,
	max: SYNTH_WAVEFORMS.length - 1,
	defaultValue: 2, // sawtooth
	step: 1,
	clampPolicy: "reject",
	automatable: false,
});

/** Maps a stored waveform index onto its oscillator type, clamped in range. */
export function synthWaveform(index: number): SynthWaveform {
	const clamped = Math.min(
		SYNTH_WAVEFORMS.length - 1,
		Math.max(0, Math.round(index)),
	);
	return SYNTH_WAVEFORMS[clamped];
}

/** Amp-envelope attack/decay/release share one range across synth and sampler. */
const ENVELOPE_TIME = {
	unit: "seconds",
	min: 0,
	max: 4,
	scale: "logarithmic",
	automatable: false,
} as const;

export const SYNTH_AMP_ATTACK = register({
	id: "synth.ampAttack",
	label: "Attack",
	...ENVELOPE_TIME,
	defaultValue: 0.005,
});

export const SYNTH_AMP_DECAY = register({
	id: "synth.ampDecay",
	label: "Decay",
	...ENVELOPE_TIME,
	defaultValue: 0.18,
});

export const SYNTH_AMP_SUSTAIN = register({
	id: "synth.ampSustain",
	label: "Sustain",
	unit: "normalized",
	min: 0,
	max: 1,
	defaultValue: 0.6,
	automatable: false,
});

export const SYNTH_AMP_RELEASE = register({
	id: "synth.ampRelease",
	label: "Release",
	...ENVELOPE_TIME,
	defaultValue: 0.22,
});

export const SYNTH_FILTER_CUTOFF = register({
	id: "synth.filterCutoff",
	label: "Cutoff",
	unit: "hertz",
	min: 20,
	max: 20_000,
	defaultValue: 12_000,
	scale: "logarithmic",
	automatable: true,
});

/**
 * Resonant low-pass filter Q. The upper bound is finite but deliberately
 * generous so the classic self-resonant sweep is reachable (AUD/INS "extreme
 * but finite" ranges).
 */
export const SYNTH_FILTER_RESONANCE = register({
	id: "synth.filterResonance",
	label: "Resonance",
	unit: "normalized",
	min: 0,
	max: 20,
	defaultValue: 1,
	automatable: true,
});

export const SAMPLER_PITCH = register({
	id: "sampler.pitch",
	label: "Pitch",
	unit: "semitones",
	min: -24,
	max: 24,
	defaultValue: 0,
	step: 1,
	automatable: false,
});

/**
 * Sample start and end as a normalized position in the buffer (0..1). The end
 * defaults to 1 (the whole sample); the audio engine reads the material between
 * them and the domain rejects an end that is not strictly after the start.
 */
export const SAMPLER_SAMPLE_START = register({
	id: "sampler.sampleStart",
	label: "Start",
	unit: "normalized",
	min: 0,
	max: 1,
	defaultValue: 0,
	automatable: false,
});

export const SAMPLER_SAMPLE_END = register({
	id: "sampler.sampleEnd",
	label: "End",
	unit: "normalized",
	min: 0,
	max: 1,
	defaultValue: 1,
	automatable: false,
});

export const SAMPLER_AMP_ATTACK = register({
	id: "sampler.ampAttack",
	label: "Attack",
	...ENVELOPE_TIME,
	defaultValue: 0.001,
});

export const SAMPLER_AMP_DECAY = register({
	id: "sampler.ampDecay",
	label: "Decay",
	...ENVELOPE_TIME,
	defaultValue: 0.1,
});

export const SAMPLER_AMP_SUSTAIN = register({
	id: "sampler.ampSustain",
	label: "Sustain",
	unit: "normalized",
	min: 0,
	max: 1,
	defaultValue: 1,
	automatable: false,
});

export const SAMPLER_AMP_RELEASE = register({
	id: "sampler.ampRelease",
	label: "Release",
	...ENVELOPE_TIME,
	defaultValue: 0.2,
});

/** Every synth parameter, in panel order. Keyed by its full `synth.*` id. */
export const SYNTH_PARAMETERS: readonly ParameterDefinition[] = [
	SYNTH_WAVEFORM,
	SYNTH_AMP_ATTACK,
	SYNTH_AMP_DECAY,
	SYNTH_AMP_SUSTAIN,
	SYNTH_AMP_RELEASE,
	SYNTH_FILTER_CUTOFF,
	SYNTH_FILTER_RESONANCE,
];

/** Every sampler parameter, in panel order. Keyed by its full `sampler.*` id. */
export const SAMPLER_PARAMETERS: readonly ParameterDefinition[] = [
	SAMPLER_PITCH,
	SAMPLER_SAMPLE_START,
	SAMPLER_SAMPLE_END,
	SAMPLER_AMP_ATTACK,
	SAMPLER_AMP_DECAY,
	SAMPLER_AMP_SUSTAIN,
	SAMPLER_AMP_RELEASE,
];

/**
 * The registered parameter definitions an instrument of `kind` owns. The
 * `parameter.set` command and `parse.ts` both use this to reject a parameter a
 * given instrument does not own without repeating the list.
 */
export function instrumentParameters(
	kind: "synth" | "sampler" | "drumMachine",
): readonly ParameterDefinition[] {
	switch (kind) {
		case "synth":
			return SYNTH_PARAMETERS;
		case "sampler":
			return SAMPLER_PARAMETERS;
		case "drumMachine":
			// Per-pad drum parameters are authored by LOOP-005; the machine itself
			// exposes none at this layer yet.
			return [];
	}
}

/**
 * Reads one instrument parameter's stored value, falling back to the
 * definition's default when the sparse parameter map omits it. Parameter ids
 * here are the bare `attack`/`cutoff`-style keys stored in `parameters`, not the
 * namespaced definition id.
 */
export function readInstrumentParameter(
	definition: ParameterDefinition,
	parameters: Readonly<Record<string, number>>,
): number {
	const key = bareParameterId(definition.id);
	const stored = parameters[key];
	return stored === undefined ? definition.defaultValue : stored;
}

/** Strips the `synth.`/`sampler.` namespace from a definition id. */
export function bareParameterId(id: string): string {
	const dot = id.indexOf(".");
	return dot === -1 ? id : id.slice(dot + 1);
}

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
