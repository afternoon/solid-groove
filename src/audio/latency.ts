/**
 * Declared processing latency (#883): how many frames a node holds its signal
 * back by, written down rather than measured.
 *
 * The only latency in the graph comes from `DynamicsCompressorNode`, which
 * looks ahead: it delays its output by a fixed pre-delay so its gain can react
 * to a peak before the peak leaves. Every device core that is built on one
 * (the Compressor) and the master's safety limiter (a `Tone.Limiter`, which is
 * one too) declares that pre-delay as its latency, and plugin delay
 * compensation (`latencyCompensation.ts`) aligns every path from it.
 *
 * The figure is a property of the Web Audio *engine*, not of any parameter:
 * Chromium, Firefox and WebKit all run the same compressor kernel, which holds
 * a fixed 6 ms, truncated to whole frames and capped by its 1024-frame
 * buffer. That is {@link BROWSER_DYNAMICS_LOOKAHEAD}, and production never
 * uses anything else. The unit suites render on `node-web-audio-api`, whose
 * compressor rounds the same 6 ms up to whole 128-frame blocks; its install
 * (`testAudioContext.ts`) declares its own figure through
 * {@link declareDynamicsLookahead}. Both declarations are pinned by a test
 * that cross-correlates a rendered compressor against a dry path in that
 * engine, so a wrong constant fails CI rather than drifting a mix.
 */

/** Frames something delays its signal by, at a sample rate. */
export type DeclaredLatency = (sampleRate: number) => number;

/** The compressor kernel's pre-delay, in seconds, in every browser. */
export const DYNAMICS_PRE_DELAY_SECONDS = 0.006;

/** The kernel's pre-delay buffer: no pre-delay can reach it. */
const MAX_PRE_DELAY_FRAMES = 1024;

/**
 * The browsers' figure: 6 ms, computed in single precision and truncated as
 * the kernel does, and never more than its buffer holds (so 1023 frames at
 * 192 kHz rather than 1152). 288 frames at 48 kHz, 264 at 44.1 kHz.
 */
export const BROWSER_DYNAMICS_LOOKAHEAD: DeclaredLatency = (sampleRate) =>
  Math.min(
    MAX_PRE_DELAY_FRAMES - 1,
    Math.floor(Math.fround(Math.fround(DYNAMICS_PRE_DELAY_SECONDS) * sampleRate)),
  );

let lookahead: DeclaredLatency = BROWSER_DYNAMICS_LOOKAHEAD;

/** Frames a `DynamicsCompressorNode` delays its output by, in this engine. */
export function dynamicsLookaheadFrames(sampleRate: number): number {
  return lookahead(sampleRate);
}

/**
 * Declares the running engine's compressor pre-delay. Only an engine other
 * than a browser's calls this — the unit suites' `node-web-audio-api`, as it
 * is installed — so production code never does.
 */
export function declareDynamicsLookahead(model: DeclaredLatency): void {
  lookahead = model;
}

/** A device core that delays nothing. */
export const NO_LATENCY: DeclaredLatency = () => 0;
