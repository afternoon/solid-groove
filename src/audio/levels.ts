/**
 * One track's level at an instant (#447): the smoothed RMS a meter's bar
 * shows, and the loudest sample since the last reading, which is what says
 * whether the track is clipping. Both in dBFS; silence is `-Infinity`.
 */
export interface LevelReading {
  readonly rmsDb: number;
  readonly peakDb: number;
}

/** A meter's value: one number in mono, one per channel in stereo. */
export function loudestDb(value: number | readonly number[]): number {
  return typeof value === "number" ? value : Math.max(-Infinity, ...value);
}

/** The loudest absolute sample across channels, in dBFS. */
export function peakDbOf(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const samples of channels) {
    for (const sample of samples) {
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}
