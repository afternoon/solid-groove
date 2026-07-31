// Loop rendering, bar-grid verification, and seam analysis.
//
// docs/sample-library.md section 10 ("Loops") sets four requirements a loop has
// to meet before it can be delivered: its BPM must be verified against the bar
// grid rather than trusted from a filename, its exact bar count and time
// signature must be recorded, its boundaries must land on integer sample
// positions, and it must survive at least 32 repeated cycles without a seam.
//
// All four are measured here and written into the manifest's `audio.seam` and
// `audio.grid` blocks, so `validate.mjs` checks a *measurement* rather than a
// claim. A synthesized loop is seamless by construction — every hit is mixed in
// with wrap-around, so a tail that runs past the last bar reappears at the top
// of the loop instead of being cut — but the pipeline still measures it,
// because the same rules have to reject an acquired loop that is not.

import { dbfs, mixInto, SAMPLE_RATE } from "./dsp.mjs";

/**
 * Section 10: "Align boundaries to integer sample positions." A loop whose
 * length is not a whole number of samples has a seam that no amount of editing
 * fixes, so the grid check is exact rather than tolerant.
 */
export function loopFrames(
	{ bpm, bars, timeSignature = "4/4" },
	sampleRate = SAMPLE_RATE,
) {
	const [numerator, denominator] = parseTimeSignature(timeSignature);
	// Beats-per-bar in quarter notes, so 6/8 is three quarter notes, not six.
	const quarterNotesPerBar = (numerator * 4) / denominator;
	const exact = (sampleRate * 60 * quarterNotesPerBar * bars) / bpm;
	return { exact, frames: Math.round(exact), aligned: Number.isInteger(exact) };
}

export function parseTimeSignature(timeSignature) {
	const match = /^(\d+)\/(\d+)$/.exec(timeSignature ?? "");
	if (!match) throw new Error(`malformed time signature "${timeSignature}"`);
	return [Number(match[1]), Number(match[2])];
}

/**
 * The grid facts a loop's manifest entry records, as measured from the rendered
 * buffer rather than from the entry that asked for it.
 *
 * `errorSamples` is the distance between the buffer that actually exists and
 * the buffer the declared BPM/bars/time signature require. Non-zero means the
 * declared tempo is wrong — which is exactly the "never trust filenames alone"
 * failure section 10 is about — and the validator rejects it.
 */
export function verifyGrid(samples, { bpm, bars, timeSignature }, sampleRate) {
	const { exact, frames, aligned } = loopFrames(
		{ bpm, bars, timeSignature },
		sampleRate,
	);
	const actual = frameCount(samples);
	return {
		bpm,
		bars,
		timeSignature,
		expectedFrames: frames,
		errorSamples: actual - frames,
		// A tempo/length pair that does not land on a whole sample cannot be
		// delivered seamlessly, so it is reported separately from a wrong tempo.
		sampleAligned: aligned,
		exactFrames: round(exact, 4),
	};
}

/** Cycles the seam is tested over — section 10's "at least 32 cycles". */
export const SEAM_CYCLES = 32;

/**
 * Measure the loop's seam by actually repeating it.
 *
 * The honest test is the one section 10 describes: play the file back to back
 * and listen for the click. The mechanical equivalent is to concatenate the
 * buffer `SEAM_CYCLES` times and compare the largest sample-to-sample step that
 * appears *only* at a wrap point against the largest step inside the loop. A
 * loop whose wrap step is no worse than its own interior transients has no
 * audible seam; one whose wrap step is an outlier does.
 *
 * Concatenation is exact repetition, so the wrap step is identical at every
 * cycle — but this builds and scans the real 32-cycle signal anyway rather than
 * asserting that equivalence, because the point of the check is to be a
 * measurement of the delivered audio and not an argument about one.
 */
export function analyzeSeam(samples, { cycles = SEAM_CYCLES } = {}) {
	const channels = asChannels(samples);
	const frames = frameCount(samples);
	if (frames < 2) {
		return {
			cyclesVerified: cycles,
			wrapStepDbfs: 0,
			interiorStepDbfs: 0,
			seamless: false,
		};
	}

	let interiorStep = 0;
	let wrapStep = 0;
	for (const channel of channels) {
		const repeated = repeat(channel, cycles);
		for (let index = 1; index < repeated.length; index++) {
			const step = Math.abs(repeated[index] - repeated[index - 1]);
			if (index % frames === 0) {
				if (step > wrapStep) wrapStep = step;
			} else if (step > interiorStep) {
				interiorStep = step;
			}
		}
	}

	return {
		cyclesVerified: cycles,
		wrapStepDbfs: round(dbfs(wrapStep), 2),
		interiorStepDbfs: round(dbfs(interiorStep), 2),
		seamless: isSeamless(wrapStep, interiorStep),
	};
}

/**
 * A wrap step below the absolute floor is inaudible whatever the loop contains;
 * above it, the seam is only acceptable when the loop's own material already
 * moves that fast, so a busy percussion loop is not held to the same absolute
 * step as a pad.
 */
export const SEAM_FLOOR_DBFS = -60;

function isSeamless(wrapStep, interiorStep) {
	if (dbfs(wrapStep) <= SEAM_FLOOR_DBFS) return true;
	return wrapStep <= interiorStep;
}

/**
 * Render one loop entry: mix each pattern hit's rendered source into a buffer
 * of exactly the declared length, wrapping anything past the end back to the
 * start.
 *
 * `renderSource(sourceId)` returns the one-shot samples for a catalogue ID; the
 * caller supplies it so this module never imports the catalogue or the voice
 * renderers and stays testable with a two-sample stub.
 */
export function renderLoop(entry, renderSource, sampleRate = SAMPLE_RATE) {
	const { frames, aligned } = loopFrames(entry, sampleRate);
	if (!aligned) {
		throw new Error(
			`${entry.name}: ${entry.bars} bar(s) of ${entry.timeSignature} at ${entry.bpm} BPM is not a whole number of samples`,
		);
	}
	const [numerator, denominator] = parseTimeSignature(entry.timeSignature);
	const stepsPerBar = (numerator * 16) / denominator;
	const framesPerStep = frames / (entry.bars * stepsPerBar);

	const buffer = new Float32Array(frames);
	for (const hit of entry.pattern) {
		const source = renderSource(hit.source);
		for (const step of hit.steps) {
			const offset = Math.round(step * framesPerStep);
			mixWrapped(buffer, source, offset, hit.gain ?? 1);
		}
	}
	return buffer;
}

/**
 * Mix `source` in at `offset`, wrapping past the end.
 *
 * This is what makes a synthesized loop genuinely seamless rather than
 * seamless-looking: a hat on the last 16th whose tail runs 200 ms past the bar
 * line contributes those 200 ms to the *start* of the loop, which is exactly
 * what happens when the file is played back to back.
 */
function mixWrapped(buffer, source, offset, gain) {
	const frames = buffer.length;
	const start = ((offset % frames) + frames) % frames;
	const head = Math.min(source.length, frames - start);
	mixInto(buffer, source.subarray(0, head), start, gain);
	let remaining = source.length - head;
	let consumed = head;
	while (remaining > 0) {
		const chunk = Math.min(remaining, frames);
		mixInto(buffer, source.subarray(consumed, consumed + chunk), 0, gain);
		consumed += chunk;
		remaining -= chunk;
	}
}

function repeat(channel, cycles) {
	const out = new Float32Array(channel.length * cycles);
	for (let cycle = 0; cycle < cycles; cycle++) {
		out.set(channel, cycle * channel.length);
	}
	return out;
}

function asChannels(samples) {
	return ArrayBuffer.isView(samples) ? [samples] : samples;
}

function frameCount(samples) {
	return asChannels(samples)[0]?.length ?? 0;
}

function round(value, places) {
	const factor = 10 ** places;
	return Math.round(value * factor) / factor;
}
