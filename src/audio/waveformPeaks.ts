/**
 * A decoded sound's loudness across its length, for drawing its waveform in a
 * well (#447). This scans the real samples of a buffer the engine has already
 * decoded to play, once per decode — nothing is loaded twice.
 */

/** The shape of a decoded buffer this needs; `Tone.ToneAudioBuffer` has it. */
export interface DecodedChannels {
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * The peak absolute sample in each of `buckets` equal slices of the buffer,
 * across every channel, scaled so the loudest slice is 1. A silent buffer
 * comes back all zeros rather than dividing by nothing.
 */
export function peaksOf(buffer: DecodedChannels, buckets: number): Float32Array {
  const peaks = new Float32Array(Math.max(0, Math.floor(buckets)));
  if (peaks.length === 0) return peaks;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    const size = data.length / peaks.length;
    for (let bucket = 0; bucket < peaks.length; bucket++) {
      const end = Math.min(data.length, Math.floor((bucket + 1) * size));
      let peak = peaks[bucket];
      for (let i = Math.floor(bucket * size); i < end; i++) {
        const value = Math.abs(data[i]);
        if (value > peak) peak = value;
      }
      peaks[bucket] = peak;
    }
  }
  let loudest = 0;
  for (const peak of peaks) loudest = Math.max(loudest, peak);
  if (loudest > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= loudest;
  return peaks;
}

/** Each buffer's peaks, by bucket count; a buffer's samples never change. */
const cache = new WeakMap<DecodedChannels, Map<number, Float32Array>>();

/**
 * {@link peaksOf}, remembered: every well drawing one sound at one width
 * shares one scan. Keyed weakly on the buffer, so a released buffer takes its
 * peaks with it.
 */
export function cachedPeaksOf(buffer: DecodedChannels, buckets: number): Float32Array {
  let byBuckets = cache.get(buffer);
  if (!byBuckets) {
    byBuckets = new Map();
    cache.set(buffer, byBuckets);
  }
  let peaks = byBuckets.get(buckets);
  if (!peaks) {
    peaks = peaksOf(buffer, buckets);
    byBuckets.set(buckets, peaks);
  }
  return peaks;
}
