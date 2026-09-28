import { z } from "zod";

/**
 * The song's musical key (ARR-010): a root pitch class and a scale.
 *
 * It is song state, saved with the project, so the piano roll reopens in the
 * key a producer chose and `notes.quantizeToScale` has something to pull notes
 * into. It never limits what a note may be: a scale only decides which rows
 * the piano roll shows and where Quantize to scale moves a stray note.
 *
 * Chromatic is the default and means "no key". Its root carries no meaning, so
 * it is pinned to C by `checkSongIntegrity` rather than left free: two
 * chromatic keys are then always equal, and a saved project cannot hold a
 * root nobody can see or change.
 */

/** The scales a key can use, in the order the piano roll offers them. */
export const SCALE_IDS = [
  "chromatic",
  "major",
  "minor",
  "dorian",
  "mixolydian",
  "harmonic_minor",
  "major_pentatonic",
  "minor_pentatonic",
  "blues",
] as const;
export type ScaleId = (typeof SCALE_IDS)[number];

/** Semitones above the root that each scale holds. */
export const SCALE_INTERVALS: Readonly<Record<ScaleId, readonly number[]>> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  major_pentatonic: [0, 2, 4, 7, 9],
  minor_pentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

/** A pitch class, C = 0 through B = 11. */
export const pitchClassSchema = z.int().min(0).max(11);

export const musicalKeySchema = z.strictObject({
  root: pitchClassSchema,
  scale: z.enum(SCALE_IDS),
});
export type MusicalKey = z.infer<typeof musicalKeySchema>;

/** The key a new song starts in, and the only valid chromatic key. */
export function createChromaticKey(): MusicalKey {
  return { root: 0, scale: "chromatic" };
}

export function isChromatic(key: MusicalKey): boolean {
  return key.scale === "chromatic";
}

/** A MIDI pitch's pitch class, for any integer. */
export function pitchClassOf(pitch: number): number {
  return ((Math.trunc(pitch) % 12) + 12) % 12;
}

/** Whether a MIDI pitch belongs to the key. Every pitch is in a chromatic key. */
export function isPitchInKey(key: MusicalKey, pitch: number): boolean {
  const degree = pitchClassOf(pitch - key.root);
  return SCALE_INTERVALS[key.scale].includes(degree);
}

/**
 * The scale pitch Quantize to scale moves `pitch` onto: the nearest pitch in
 * the key, and on a tie the lower one. A pitch already in the key stays put.
 *
 * Nearest keeps a quantized line as close to what was played as the scale
 * allows, and rounding a tie down keeps the rule deterministic without
 * favouring either spelling. Every scale has a degree within two semitones of
 * any pitch, so the search always ends; a candidate outside `min..max` is
 * skipped, which is what keeps a note at the edge of the range inside it.
 */
export function nearestPitchInKey(
  key: MusicalKey,
  pitch: number,
  min = 0,
  max = 127,
): number {
  for (let distance = 0; distance < 12; distance += 1) {
    const below = pitch - distance;
    if (below >= min && isPitchInKey(key, below)) return below;
    const above = pitch + distance;
    if (above <= max && isPitchInKey(key, above)) return above;
  }
  return pitch;
}
