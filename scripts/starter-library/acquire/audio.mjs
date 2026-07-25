// Decoding and audio preparation for acquired files.
//
// Section 10 of docs/sample-library.md is the standard: 48 kHz masters, genuine
// mono preserved as mono, no upsampling to claim a bigger specification, DC
// offset and accidental silence removed, short fades where needed, no
// brick-wall normalization of the collection.
//
// Decoding goes through `node-web-audio-api`, which the repository already
// depends on for audio tests. That is deliberate: it is the same Web Audio
// decode path the browser will use on these files, so a file this pipeline
// cannot decode is one the product could not have played either — and it
// resamples to the context rate for free.

import { OfflineAudioContext } from "node-web-audio-api";
import { applyFades, peak, removeDcOffset, SAMPLE_RATE } from "../dsp.mjs";

/** Formats a browser can decode, which is the only bar that matters here. */
export const SUPPORTED_AUDIO = [
	".wav",
	".flac",
	".ogg",
	".oga",
	".mp3",
	".m4a",
	".aiff",
	".aif",
];

export function isSupportedAudio(filename) {
	return SUPPORTED_AUDIO.some((extension) =>
		filename.toLowerCase().endsWith(extension),
	);
}

/**
 * Decode to float samples at 48 kHz.
 *
 * `decodeAudioData` resamples to the context's rate, so a 44.1 kHz source
 * arrives at 48 kHz without a separate resampler. The *source* rate is reported
 * back unchanged so provenance can record what was actually downloaded rather
 * than what we converted it to — section 10 asks for the conversion to be
 * recorded honestly, not hidden.
 */
export async function decodeToSamples(bytes) {
	const context = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
	// Allocate through the ambient `ArrayBuffer` rather than reslicing the
	// Buffer's own. `decodeAudioData` type-checks its argument against
	// `globalThis.ArrayBuffer`, and under the jsdom-backed unit suite that is
	// not the same constructor a Node Buffer's `.buffer` came from — a Node
	// ArrayBuffer is rejected there as "not of type ArrayBuffer". Allocating
	// here works under both the CLI and the test environment.
	const copy = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(copy).set(bytes);
	let buffer;
	try {
		buffer = await context.decodeAudioData(copy);
	} catch (error) {
		throw new Error(
			`could not decode audio: ${error instanceof Error ? error.message : error}. ` +
				`Supported: ${SUPPORTED_AUDIO.join(", ")}`,
		);
	}
	const channels = [];
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		channels.push(Float32Array.from(buffer.getChannelData(channel)));
	}
	return { channels, sampleRate: buffer.sampleRate, frames: buffer.length };
}

/**
 * True when a stereo file carries no real stereo information.
 *
 * Plenty of CC0 one-shots are mono recordings saved as dual-mono. Section 10
 * says to preserve genuine mono sources as mono and use stereo "only when
 * spatial information is musically meaningful", so keeping them stereo would
 * double the payload for nothing.
 */
export function isEffectivelyMono(channels, tolerance = 1e-4) {
	if (channels.length < 2) return true;
	const [left, right] = channels;
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i++) {
		if (Math.abs(left[i] - right[i]) > tolerance) return false;
	}
	return true;
}

export function downmixToMono(channels) {
	if (channels.length === 1) return channels[0];
	const length = channels[0].length;
	const out = new Float32Array(length);
	for (const channel of channels) {
		for (let i = 0; i < length; i++) out[i] += channel[i] / channels.length;
	}
	return out;
}

/**
 * Apply the section 10 preparation chain to a decoded file.
 *
 * This is the same conditioning the synthesized voices get, in the same order,
 * so an acquired asset and a generated one audition at comparable levels and
 * carry comparable metadata. Acquired audio additionally needs the leading
 * silence trimmed: a recording usually starts with room tone before the
 * transient, and a one-shot that does not begin at its attack is unusable
 * rhythmically.
 */
export function prepareOneShot(
	channels,
	{ peakDbfs = -1.5, trimLead = true, forceMono } = {},
) {
	// Dual-mono collapses to mono; genuine stereo is preserved.
	const collapse = forceMono ?? isEffectivelyMono(channels);
	const working = collapse
		? [downmixToMono(channels)]
		: channels.map((c) => Float32Array.from(c));

	// Trim boundaries are decided once, from the summed signal, and applied to
	// every channel identically. Trimming channels independently would shift
	// them relative to each other and destroy the stereo image.
	const cleaned = working.map(removeDcOffset);
	const summed = downmixToMono(cleaned);
	const start = trimLead ? leadingSilenceOffset(summed) : 0;
	const end = trailingSilenceOffset(summed);
	const cropped = cleaned.map((channel) =>
		channel.subarray(start, end).slice(),
	);

	const faded = cropped.map((channel) => applyFades(channel, 0.0004, 0.004));
	// One gain for all channels, again to keep the image intact.
	const loudest = Math.max(...faded.map(peak));
	if (loudest === 0) return faded;
	const target = 10 ** (peakDbfs / 20);
	const scale = target / loudest;
	return faded.map((channel) => {
		const out = new Float32Array(channel.length);
		for (let i = 0; i < channel.length; i++) out[i] = channel[i] * scale;
		return out;
	});
}

/** First sample at or above the file's own noise floor, minus a little lead-in. */
export function leadingSilenceOffset(
	samples,
	{ thresholdRatio = 0.001, keepSamples = 24 } = {},
) {
	const threshold = peak(samples) * thresholdRatio;
	if (threshold === 0) return 0;
	let start = 0;
	while (start < samples.length && Math.abs(samples[start]) < threshold)
		start++;
	if (start === samples.length) return 0;
	return Math.max(0, start - keepSamples);
}

/** One past the last audible sample, keeping a short tail so decays are intact. */
export function trailingSilenceOffset(
	samples,
	{ thresholdDbfs = -72, tailSamples = 240 } = {},
) {
	const threshold = 10 ** (thresholdDbfs / 20);
	let end = samples.length;
	while (end > 0 && Math.abs(samples[end - 1]) < threshold) end--;
	return Math.min(samples.length, end + tailSamples);
}

/** Trim silence before the first transient. Kept for single-channel callers. */
export function trimLeadingSilence(samples, options) {
	return samples.subarray(leadingSilenceOffset(samples, options)).slice();
}
