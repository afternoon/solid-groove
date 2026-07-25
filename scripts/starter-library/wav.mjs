// WAV encoding, hashing, and the ingestion-time analysis recorded in the
// manifest (docs/sample-library.md sections 9, 10 and 12).

import { createHash } from "node:crypto";
import { dbfs, peak, rms, SAMPLE_RATE } from "./dsp.mjs";

export const BIT_DEPTH = 24;

/**
 * Encode mono float samples in [-1, 1] as a 24-bit PCM WAV.
 *
 * Masters are 48 kHz / 24-bit per the audio preparation standards. Sources are
 * genuinely mono here — these are synthesized one-shots with no meaningful
 * spatial information — so they stay mono rather than being widened to claim a
 * bigger specification.
 */
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
	const bytesPerSample = BIT_DEPTH / 8;
	const dataSize = samples.length * bytesPerSample;
	const buffer = Buffer.alloc(44 + dataSize);
	let offset = 0;
	const ascii = (text) => {
		buffer.write(text, offset, "ascii");
		offset += text.length;
	};
	const u32 = (value) => {
		buffer.writeUInt32LE(value, offset);
		offset += 4;
	};
	const u16 = (value) => {
		buffer.writeUInt16LE(value, offset);
		offset += 2;
	};

	ascii("RIFF");
	u32(36 + dataSize);
	ascii("WAVE");
	ascii("fmt ");
	u32(16); // PCM chunk size
	u16(1); // format: PCM
	u16(1); // channels: mono
	u32(sampleRate);
	u32(sampleRate * bytesPerSample); // byte rate
	u16(bytesPerSample); // block align
	u16(BIT_DEPTH);
	ascii("data");
	u32(dataSize);

	// 24-bit signed little-endian. The asymmetric clamp keeps the negative
	// extreme representable instead of wrapping to positive full scale.
	const maximum = 2 ** (BIT_DEPTH - 1) - 1;
	const minimum = -(2 ** (BIT_DEPTH - 1));
	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]));
		const value = Math.max(
			minimum,
			Math.min(maximum, Math.round(clamped * maximum)),
		);
		buffer.writeIntLE(value, offset, 3);
		offset += 3;
	}
	return buffer;
}

export function sha256(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Compact min/max waveform peaks, so the library browser can draw a waveform
 * without downloading the audio (docs/sample-library.md section 12).
 */
export function waveformPeaks(samples, buckets = 64) {
	const peaks = [];
	// Bucket boundaries are computed proportionally rather than by a fixed
	// stride: a stride leaves short assets with fewer buckets than declared,
	// and a client that trusts `buckets` would then draw a truncated waveform.
	for (let bucket = 0; bucket < buckets; bucket++) {
		const start = Math.floor((bucket * samples.length) / buckets);
		const end = Math.floor(((bucket + 1) * samples.length) / buckets);
		let low = 0;
		let high = 0;
		for (let i = start; i < end; i++) {
			if (samples[i] < low) low = samples[i];
			if (samples[i] > high) high = samples[i];
		}
		peaks.push(round(low, 3), round(high, 3));
	}
	return peaks;
}

function round(value, places) {
	const factor = 10 ** places;
	return Math.round(value * factor) / factor;
}

/** The audio facts the manifest records for every asset. */
export function analyze(samples, sampleRate = SAMPLE_RATE) {
	const peakAmplitude = peak(samples);
	return {
		sampleRate,
		bitDepth: BIT_DEPTH,
		channels: 1,
		durationSeconds: round(samples.length / sampleRate, 4),
		peakDbfs: round(dbfs(peakAmplitude), 2),
		rmsDbfs: round(dbfs(rms(samples)), 2),
	};
}

/**
 * Content-addressed storage key. Identity is the hash of the bytes, never the
 * source URL or a human filename, so re-running the build is idempotent and a
 * project can pin an exact asset version (sections 9 and 12).
 */
export function storageKeyFor(hash) {
	return `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.wav`;
}
