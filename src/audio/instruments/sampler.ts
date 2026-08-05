import * as Tone from "tone";
import {
	readInstrumentParameter,
	SAMPLER_AMP_ATTACK,
	SAMPLER_AMP_DECAY,
	SAMPLER_AMP_RELEASE,
	SAMPLER_AMP_SUSTAIN,
	SAMPLER_PITCH,
	SAMPLER_SAMPLE_END,
	SAMPLER_SAMPLE_START,
} from "../../domain/parameters";
import {
	attachAssetVoice,
	clampUnit,
	createAssetVoice,
	releaseAssetVoice,
} from "./assetVoice";
import type {
	InstrumentGraphContext,
	InstrumentNode,
	SamplerInstrument,
} from "./types";

/** The sampler's playback + envelope settings, resolved from its parameters. */
interface SamplerSettings {
	pitch: number;
	sampleStart: number;
	sampleEnd: number;
	attack: number;
	decay: number;
	sustain: number;
	release: number;
}

function readSamplerSettings(instrument: SamplerInstrument): SamplerSettings {
	const p = instrument.parameters;
	return {
		pitch: readInstrumentParameter(SAMPLER_PITCH, p),
		sampleStart: readInstrumentParameter(SAMPLER_SAMPLE_START, p),
		sampleEnd: readInstrumentParameter(SAMPLER_SAMPLE_END, p),
		attack: readInstrumentParameter(SAMPLER_AMP_ATTACK, p),
		decay: readInstrumentParameter(SAMPLER_AMP_DECAY, p),
		sustain: readInstrumentParameter(SAMPLER_AMP_SUSTAIN, p),
		release: readInstrumentParameter(SAMPLER_AMP_RELEASE, p),
	};
}

/**
 * Plays `buffer` once, pitched and windowed to the sampler's settings, through
 * a per-trigger amplitude envelope that self-disposes when the note is done —
 * the short-lived voice AUD-08 permits, as long as it leaves nothing scheduled
 * behind it. Voices carry no reference to the instrument, so a settings edit
 * mid-note never mutates a note already sounding.
 */
function playSampledVoice(
	buffer: Tone.ToneAudioBuffer,
	destination: Tone.ToneAudioNode,
	settings: SamplerSettings,
	time: Tone.Unit.Time,
	duration: Tone.Unit.Time,
	velocity: number,
): void {
	const bufferSeconds = buffer.duration;
	const offset = clampUnit(settings.sampleStart) * bufferSeconds;
	const end = clampUnit(settings.sampleEnd) * bufferSeconds;
	const windowSeconds = Math.max(0, end - offset);
	if (windowSeconds <= 0) return;

	const envelope = new Tone.AmplitudeEnvelope({
		attack: settings.attack,
		decay: settings.decay,
		sustain: settings.sustain,
		release: settings.release,
	}).connect(destination);
	// Velocity scales the peak so a soft hit is quieter, without touching the
	// envelope's own shape.
	const gain = new Tone.Gain(velocity).connect(envelope);
	const player = new Tone.Player(buffer).connect(gain);
	player.playbackRate = 2 ** (settings.pitch / 12);

	// The audible slice is the sample window, but the amp envelope's release
	// tail is what actually ends the voice; hold the player through both.
	const holdSeconds = Math.min(
		windowSeconds / player.playbackRate,
		Tone.Time(duration).toSeconds(),
	);
	envelope.triggerAttackRelease(holdSeconds, time, velocity);
	player.start(time, offset, windowSeconds);
	player.onstop = () => {
		player.dispose();
		gain.dispose();
		// The envelope's release runs past the player's stop, so let it ring out
		// before disposal rather than cutting the tail.
		const releaseMs = (settings.release + 0.05) * 1000;
		setTimeout(() => envelope.dispose(), releaseMs);
	};
}

export function createSamplerInstrumentNode(
	instrument: SamplerInstrument,
	context: InstrumentGraphContext,
): InstrumentNode {
	const output = new Tone.Gain(1);
	const voice = createAssetVoice();
	attachAssetVoice(voice, context, instrument.assetId);
	let settings = readSamplerSettings(instrument);

	return {
		kind: "sampler",
		output,
		trigger(trigger, time, duration, velocity) {
			if (trigger.kind !== "pitch" || !voice.buffer) return;
			playSampledVoice(
				voice.buffer,
				output,
				settings,
				time,
				duration,
				velocity,
			);
		},
		update(next) {
			if (next.kind !== "sampler") return;
			if (next.assetId !== voice.assetId) {
				// A new asset id abandons the old subscription; `AudioBufferCache`
				// generation tracking cancels any in-flight decode of the old sample
				// so a stale load can never reconnect.
				attachAssetVoice(voice, context, next.assetId);
			}
			// Playback and envelope settings are read on the *next* trigger; there is
			// no persistent node to smooth, so this is a plain assignment. Notes
			// already sounding keep the settings they were triggered with.
			settings = readSamplerSettings(next);
		},
		dispose() {
			releaseAssetVoice(voice, context.scope);
			output.dispose();
		},
	};
}
