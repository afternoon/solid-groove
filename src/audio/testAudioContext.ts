import * as nwaa from "node-web-audio-api";

/**
 * jsdom has no Web Audio API, so Tone.js cannot render. `node-web-audio-api`
 * provides a real, native (offline-capable) implementation. Installing its
 * classes as globals lets Tone's bundled `standardized-audio-context` build on
 * top of them, so the real ToneInstrument classes render actual audio in tests.
 *
 * Call this once, before importing Tone, to enable offline rendering.
 */
export function installWebAudioGlobals(): void {
	const classes = [
		"AudioContext",
		"OfflineAudioContext",
		"AudioParam",
		"AudioNode",
		"AudioBuffer",
		"AudioBufferSourceNode",
		"GainNode",
		"OscillatorNode",
		"BiquadFilterNode",
		"AnalyserNode",
		"ConstantSourceNode",
		"AudioWorkletNode",
		"AudioDestinationNode",
	] as const;

	for (const key of classes) {
		const impl = (nwaa as unknown as Record<string, unknown>)[key];
		if (impl && !(key in globalThis)) {
			(globalThis as Record<string, unknown>)[key] = impl;
		}
	}
}

/** Root-mean-square amplitude of a rendered mono channel — a proxy for output energy. */
export function rms(data: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < data.length; i++) {
		sum += data[i] * data[i];
	}
	return Math.sqrt(sum / data.length);
}

/**
 * High-frequency energy proxy: RMS of the first difference (discrete
 * derivative) of the signal. The derivative emphasizes rapid sample-to-sample
 * change, so this rises with high-frequency content and is a robust, FFT-free
 * way to detect a lowpass filter opening or closing. Total RMS is a poor
 * discriminator here because a sawtooth's low fundamental dominates its energy
 * regardless of cutoff.
 */
export function hfEnergy(data: Float32Array): number {
	let sum = 0;
	for (let i = 1; i < data.length; i++) {
		const d = data[i] - data[i - 1];
		sum += d * d;
	}
	return Math.sqrt(sum / Math.max(1, data.length - 1));
}

/** RMS over a sub-window [startFrac, endFrac) of the buffer (fractions of length). */
export function rmsWindow(
	data: Float32Array,
	startFrac: number,
	endFrac: number,
): number {
	const start = Math.floor(data.length * startFrac);
	const end = Math.floor(data.length * endFrac);
	let sum = 0;
	for (let i = start; i < end; i++) {
		sum += data[i] * data[i];
	}
	return Math.sqrt(sum / Math.max(1, end - start));
}
