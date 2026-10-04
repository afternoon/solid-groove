/**
 * Helpers for pinning a declared latency against a render (tests only, #883):
 * a deterministic noise burst to send through a path, and the lag at which
 * the path's output best lines up with the dry signal.
 */

/** `frames` of seeded white noise in [-amplitude, amplitude]: no two lags of
 * it look alike, so the cross-correlation has exactly one peak. */
export function noiseBurst(frames: number, amplitude = 0.25, seed = 883): Float32Array {
  const data = new Float32Array(frames);
  let state = seed >>> 0;
  for (let i = 0; i < frames; i++) {
    // A 32-bit LCG (Numerical Recipes): plenty for a test signal.
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    data[i] = (state / 0xffff_ffff - 0.5) * 2 * amplitude;
  }
  return data;
}

/**
 * The lag, in frames, at which `delayed` best matches `reference`: the peak
 * of their cross-correlation over `0..maxLag`. A path that only delays (or
 * also changes level, or gently compresses) peaks at exactly its latency.
 */
export function bestLag(
  reference: Float32Array,
  delayed: Float32Array,
  maxLag: number,
): number {
  let best = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let lag = 0; lag <= maxLag; lag++) {
    let score = 0;
    const end = Math.min(reference.length, delayed.length - lag);
    for (let i = 0; i < end; i++) score += reference[i] * delayed[i + lag];
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}
