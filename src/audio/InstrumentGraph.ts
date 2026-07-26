import * as Tone from "tone";
import type { DrumPad, Instrument, NoteTrigger } from "../domain/entities";
import type { AssetId, PadId } from "../domain/ids";
import type { AudioAssetProjection } from "../projection/audioProjection";
import type { AudioBufferCache, BufferSubscription } from "./AudioBufferCache";
import type { AudioProjectScope } from "./AudioRuntime";

/** Schema v1 models `Instrument` as one discriminated union rather than
 * exporting each variant separately; these local aliases narrow it by `kind`
 * for the factory below. */
type SamplerInstrument = Extract<Instrument, { kind: "sampler" }>;
type SynthInstrument = Extract<Instrument, { kind: "synth" }>;
type DrumMachineInstrument = Extract<Instrument, { kind: "drumMachine" }>;

/**
 * A track's sound source, keyed to the track by the track graph that owns it
 * (PRD AUD-08, section 9.7). `update()` applies an instrument of the *same*
 * `kind` in place — asset swaps, drum-pad add/remove, and generic parameter
 * edits are all handled without replacing this node. The owning
 * `TrackAudioGraph` only ever replaces the whole node when `kind` itself
 * changes (sampler <-> synth <-> drumMachine, or null <-> present).
 */
export interface InstrumentNode {
	readonly kind: Instrument["kind"];
	readonly output: Tone.ToneAudioNode;
	trigger(
		trigger: NoteTrigger,
		time: Tone.Unit.Time,
		duration: Tone.Unit.Time,
		velocity: number,
	): void;
	update(instrument: Instrument): void;
	dispose(): void;
}

export interface InstrumentGraphContext {
	readonly scope: AudioProjectScope;
	readonly assetsById: ReadonlyMap<AssetId, AudioAssetProjection>;
	readonly bufferCache: AudioBufferCache<Tone.ToneAudioBuffer>;
}

export type InstrumentNodeFactory = (
	instrument: Instrument,
	context: InstrumentGraphContext,
) => InstrumentNode;

/**
 * Plays `buffer` once through `destination`, self-disposing once it stops —
 * the "short-lived source node" AUD-08 explicitly permits per note/trigger,
 * as long as its schedule and references don't accumulate after completion.
 *
 * `offsetSeconds` is a position inside the buffer's own timeline, so a clip
 * or placement trimmed at its left edge starts from the material the
 * arrangement draws rather than from sample zero.
 */
export function playOneShot(
	buffer: Tone.ToneAudioBuffer,
	destination: Tone.ToneAudioNode,
	time: Tone.Unit.Time,
	duration: Tone.Unit.Time,
	playbackRate = 1,
	offsetSeconds = 0,
): void {
	const player = new Tone.Player(buffer).connect(destination);
	player.playbackRate = playbackRate;
	player.onstop = () => player.dispose();
	player.start(time, offsetSeconds, duration);
}

/** A live subscription to one asset's decoded buffer, reattachable to a new asset id. */
interface AssetVoice {
	assetId: AssetId | null;
	buffer: Tone.ToneAudioBuffer | null;
	subscription: BufferSubscription | null;
	subscriptionHandle: ReturnType<AudioProjectScope["register"]> | null;
}

function createAssetVoice(): AssetVoice {
	return {
		assetId: null,
		buffer: null,
		subscription: null,
		subscriptionHandle: null,
	};
}

function attachAssetVoice(
	voice: AssetVoice,
	context: InstrumentGraphContext,
	assetId: AssetId | null,
): void {
	voice.subscription?.release();
	voice.subscription = null;
	if (voice.subscriptionHandle) {
		void context.scope.release(voice.subscriptionHandle);
		voice.subscriptionHandle = null;
	}
	voice.buffer = null;
	voice.assetId = assetId;
	if (!assetId) return;

	const asset = context.assetsById.get(assetId);
	if (!asset) return;

	voice.subscriptionHandle = context.scope.register("subscription", () => {});
	voice.subscription = context.bufferCache.subscribe(asset, (buffer) => {
		voice.buffer = buffer;
	});
}

function releaseAssetVoice(voice: AssetVoice, scope: AudioProjectScope): void {
	voice.subscription?.release();
	voice.subscription = null;
	if (voice.subscriptionHandle) {
		void scope.release(voice.subscriptionHandle);
		voice.subscriptionHandle = null;
	}
	voice.buffer = null;
}

// --- Sampler -----------------------------------------------------------

function createSamplerInstrumentNode(
	instrument: SamplerInstrument,
	context: InstrumentGraphContext,
): InstrumentNode {
	const output = new Tone.Gain(1);
	const voice = createAssetVoice();
	attachAssetVoice(voice, context, instrument.assetId);

	return {
		kind: "sampler",
		output,
		trigger(trigger, time, duration) {
			// Per-pitch playback rate and round-robin are Phase 1 sampler-device
			// concerns; the v1 scaffold plays the loaded one-shot at normal rate
			// on any pitch trigger so the note-scheduling contract is provable
			// ahead of that DSP.
			if (trigger.kind !== "pitch" || !voice.buffer) return;
			playOneShot(voice.buffer, output, time, duration);
		},
		update(next) {
			if (next.kind !== "sampler") return;
			if (next.assetId !== voice.assetId) {
				attachAssetVoice(voice, context, next.assetId);
			}
		},
		dispose() {
			releaseAssetVoice(voice, context.scope);
			output.dispose();
		},
	};
}

// --- Synth ---------------------------------------------------------------

function createSynthInstrumentNode(
	_instrument: SynthInstrument,
	_context: InstrumentGraphContext,
): InstrumentNode {
	const synth = new Tone.PolySynth(Tone.Synth);
	const output = new Tone.Gain(1);
	synth.connect(output);

	return {
		kind: "synth",
		output,
		trigger(trigger, time, duration, velocity) {
			if (trigger.kind !== "pitch") return;
			const note = Tone.Frequency(trigger.pitch, "midi").toNote();
			synth.triggerAttackRelease(note, duration, time, velocity);
		},
		update(next) {
			if (next.kind !== "synth") return;
			// Schema v1 defines no synth parameters yet — Phase 1 authors them
			// with the synth device (PRD section 9.5 invariant 10). `parameters`
			// is carried through for forward compatibility only.
		},
		dispose() {
			synth.dispose();
			output.dispose();
		},
	};
}

// --- Drum machine ----------------------------------------------------------

interface DrumPadVoice extends AssetVoice {
	readonly gain: Tone.Gain;
}

function createDrumPadVoice(
	pad: DrumPad,
	context: InstrumentGraphContext,
	destination: Tone.ToneAudioNode,
): DrumPadVoice {
	const gain = new Tone.Gain(
		dbToLinear(pad.mixer.muted ? null : pad.mixer.volume),
	).connect(destination);
	const voice: DrumPadVoice = { ...createAssetVoice(), gain };
	attachAssetVoice(voice, context, pad.assetId);
	return voice;
}

function updateDrumPadMixer(
	voice: DrumPadVoice,
	mixer: DrumPad["mixer"],
): void {
	voice.gain.gain.rampTo(dbToLinear(mixer.muted ? null : mixer.volume), 0.02);
}

/** `null` (muted) collapses to silence; otherwise converts the stored decibel value to linear gain. */
function dbToLinear(db: number | null): number {
	return db === null ? 0 : Tone.dbToGain(db);
}

function createDrumMachineInstrumentNode(
	instrument: DrumMachineInstrument,
	context: InstrumentGraphContext,
): InstrumentNode {
	const output = new Tone.Gain(1);
	const voices = new Map<PadId, DrumPadVoice>();

	function reconcilePads(pads: readonly DrumPad[]): void {
		const nextIds = new Set(pads.map((pad) => pad.id));
		for (const [id, voice] of voices) {
			if (!nextIds.has(id)) {
				releaseAssetVoice(voice, context.scope);
				voice.gain.dispose();
				voices.delete(id);
			}
		}
		for (const pad of pads) {
			const existing = voices.get(pad.id);
			if (existing) {
				if (existing.assetId !== pad.assetId) {
					attachAssetVoice(existing, context, pad.assetId);
				}
				updateDrumPadMixer(existing, pad.mixer);
			} else {
				voices.set(pad.id, createDrumPadVoice(pad, context, output));
			}
		}
	}
	reconcilePads(instrument.pads);

	return {
		kind: "drumMachine",
		output,
		trigger(trigger, time, duration) {
			if (trigger.kind !== "pad") return;
			const voice = voices.get(trigger.padId);
			if (!voice?.buffer) return;
			playOneShot(voice.buffer, voice.gain, time, duration);
		},
		update(next) {
			if (next.kind !== "drumMachine") return;
			reconcilePads(next.pads);
		},
		dispose() {
			for (const voice of voices.values()) {
				releaseAssetVoice(voice, context.scope);
				voice.gain.dispose();
			}
			voices.clear();
			output.dispose();
		},
	};
}

// --- Factory ---------------------------------------------------------------

export function createInstrumentNode(
	instrument: Instrument,
	context: InstrumentGraphContext,
): InstrumentNode {
	switch (instrument.kind) {
		case "sampler":
			return createSamplerInstrumentNode(instrument, context);
		case "synth":
			return createSynthInstrumentNode(instrument, context);
		case "drumMachine":
			return createDrumMachineInstrumentNode(instrument, context);
	}
}
