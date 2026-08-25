// The synthesized loop catalogue (docs/sample-library.md sections 6.3 and 10).
//
// A loop entry is a *pattern*, not a rendered file: it names one-shot catalogue
// IDs and the 16th-note steps they land on, and `loops.mjs` mixes them into a
// buffer of exactly the length its BPM, bar count, and time signature require,
// wrapping tails around the loop point. That is deliberate — it means the
// library has no second synthesis path to keep in step with the one-shots, and
// every loop is seamless by construction while still being *measured* by the
// same seam check an acquired loop would face.
//
// Each group's entries are append-only for the same reason the one-shot groups
// are: the index is part of the asset ID that saved projects reference.
//
// BPMs are chosen so that the bar length is a whole number of samples at 48 kHz
// (section 10, "Align boundaries to integer sample positions"). At 4/4 that
// means 11,520,000 / BPM must be an integer — 120, 128, 90, 96, 100, 150, and
// 180 all are. A BPM that is not fails the grid check rather than shipping a
// loop with a fractional bar.

/**
 * @typedef {object} LoopEntry
 * @property {string} name           User-facing name.
 * @property {number} bpm            Verified tempo, not a filename claim.
 * @property {number} bars           Exact bar count.
 * @property {string} timeSignature  From `TIME_SIGNATURES`.
 * @property {string[]} genres       Genre IDs from the controlled vocabulary.
 * @property {string[]} characters   Character tags from the controlled vocabulary.
 * @property {string} intensity      low | medium | high | extreme.
 * @property {string} [rootNote]     Key, where the material has one.
 * @property {{source: string, steps: number[], gain?: number}[]} pattern
 */

/** @type {LoopEntry[]} */
export const DRUM_FULL_LOOPS = [
  {
    name: "Four Four Club Groove",
    bpm: 120,
    bars: 1,
    timeSignature: "4/4",
    genres: ["house", "uk-garage", "electronic-pop"],
    characters: ["clean", "punchy", "dry"],
    intensity: "medium",
    pattern: [
      { source: "sg-one-shot-drums-kick-0001", steps: [0, 4, 8, 12] },
      { source: "sg-one-shot-drums-clap-0001", steps: [4, 12], gain: 0.8 },
      {
        source: "sg-one-shot-drums-closed-hat-0001",
        steps: [2, 6, 10, 14],
        gain: 0.55,
      },
      { source: "sg-one-shot-drums-open-hat-0001", steps: [14], gain: 0.5 },
    ],
  },
  {
    name: "Driving Warehouse Beat",
    bpm: 128,
    bars: 1,
    timeSignature: "4/4",
    genres: ["techno", "house"],
    characters: ["dark", "tight", "punchy"],
    intensity: "high",
    pattern: [
      { source: "sg-one-shot-drums-kick-0002", steps: [0, 4, 8, 12] },
      {
        source: "sg-one-shot-drums-closed-hat-0002",
        steps: [2, 6, 10, 14],
        gain: 0.5,
      },
      { source: "sg-one-shot-drums-rim-0001", steps: [7, 15], gain: 0.6 },
    ],
  },
  {
    name: "Slow Dusty Break",
    bpm: 90,
    bars: 1,
    timeSignature: "4/4",
    genres: ["hip-hop", "lofi", "trap"],
    characters: ["warm", "dry", "soft"],
    intensity: "low",
    pattern: [
      { source: "sg-one-shot-drums-kick-0003", steps: [0, 6, 10] },
      { source: "sg-one-shot-drums-snare-0001", steps: [4, 12], gain: 0.85 },
      {
        source: "sg-one-shot-drums-closed-hat-0003",
        steps: [0, 2, 4, 6, 8, 10, 12, 14],
        gain: 0.4,
      },
    ],
  },
  {
    name: "Rolling Chopped Break",
    bpm: 180,
    bars: 1,
    timeSignature: "4/4",
    genres: ["drum-and-bass", "jungle", "breakbeat"],
    characters: ["gritty", "abrasive", "experimental"],
    intensity: "high",
    pattern: [
      { source: "sg-one-shot-drums-kick-0004", steps: [0, 10] },
      { source: "sg-one-shot-drums-snare-0002", steps: [4, 12], gain: 0.9 },
      {
        source: "sg-one-shot-drums-closed-hat-0004",
        steps: [2, 6, 7, 14],
        gain: 0.45,
      },
      { source: "sg-one-shot-drums-percussion-0001", steps: [11], gain: 0.5 },
    ],
  },
];

/** @type {LoopEntry[]} */
export const DRUM_TOP_LOOPS = [
  {
    name: "Shuffled Hat Top",
    bpm: 120,
    bars: 1,
    timeSignature: "4/4",
    genres: ["house", "uk-garage", "breakbeat"],
    characters: ["tight", "clean", "short"],
    intensity: "low",
    pattern: [
      {
        source: "sg-one-shot-drums-closed-hat-0001",
        steps: [0, 3, 4, 7, 8, 11, 12, 15],
        gain: 0.5,
      },
      { source: "sg-one-shot-drums-rim-0002", steps: [6, 14], gain: 0.45 },
    ],
  },
  {
    name: "Half Time Ride Top",
    bpm: 150,
    bars: 1,
    timeSignature: "4/4",
    genres: ["dubstep", "techno", "trap"],
    characters: ["metallic", "abrasive", "experimental"],
    intensity: "medium",
    pattern: [
      { source: "sg-one-shot-drums-cymbal-0002", steps: [0, 8], gain: 0.4 },
      {
        source: "sg-one-shot-drums-closed-hat-0005",
        steps: [2, 4, 6, 10, 12, 14],
        gain: 0.45,
      },
    ],
  },
];

/** @type {LoopEntry[]} */
export const PERCUSSION_LOOPS = [
  {
    name: "Hand Percussion Layer",
    bpm: 120,
    bars: 1,
    timeSignature: "4/4",
    genres: ["house", "ambient", "electronic-pop"],
    characters: ["organic", "dry", "wooden"],
    intensity: "low",
    pattern: [
      {
        source: "sg-one-shot-drums-percussion-0001",
        steps: [0, 3, 6, 9, 11, 14],
        gain: 0.55,
      },
      {
        source: "sg-one-shot-drums-percussion-0002",
        steps: [5, 13],
        gain: 0.5,
      },
    ],
  },
];

/** @type {LoopEntry[]} */
export const BASSLINE_LOOPS = [
  {
    name: "Rolling Sub Bassline",
    bpm: 128,
    bars: 1,
    timeSignature: "4/4",
    genres: ["techno", "house", "dubstep"],
    characters: ["sub-heavy", "deep", "clean"],
    intensity: "medium",
    rootNote: "C1",
    pattern: [
      { source: "sg-one-shot-bass-sub-0001", steps: [0, 6, 10], gain: 0.9 },
      { source: "sg-one-shot-bass-stab-0001", steps: [3, 13], gain: 0.6 },
    ],
  },
  {
    name: "Sparse Half Time Bass",
    bpm: 90,
    bars: 1,
    timeSignature: "4/4",
    genres: ["hip-hop", "trap", "lofi"],
    characters: ["deep", "warm", "dry"],
    intensity: "low",
    rootNote: "F1",
    pattern: [
      { source: "sg-one-shot-bass-sub-0002", steps: [0, 9], gain: 0.9 },
      { source: "sg-one-shot-bass-sustained-0001", steps: [12], gain: 0.55 },
    ],
  },
];

/** @type {LoopEntry[]} */
export const CHORD_LOOPS = [
  {
    name: "Warm Seventh Vamp",
    bpm: 120,
    bars: 1,
    timeSignature: "4/4",
    genres: ["house", "lofi", "electronic-pop"],
    characters: ["warm", "soft", "clean"],
    intensity: "low",
    rootNote: "C3",
    pattern: [
      { source: "sg-one-shot-tonal-chord-0001", steps: [0, 10], gain: 0.7 },
      { source: "sg-one-shot-tonal-stab-0001", steps: [6, 14], gain: 0.5 },
    ],
  },
];

/** @type {LoopEntry[]} */
export const MELODIC_LOOPS = [
  {
    name: "Plucked Two Bar Motif",
    bpm: 100,
    bars: 2,
    timeSignature: "4/4",
    genres: ["ambient", "electronic-pop", "trance"],
    characters: ["bright", "clean", "glassy"],
    intensity: "low",
    rootNote: "A3",
    pattern: [
      {
        source: "sg-one-shot-tonal-pluck-0001",
        steps: [0, 3, 8, 11, 16, 22, 27],
        gain: 0.65,
      },
      { source: "sg-one-shot-tonal-bell-0001", steps: [12, 28], gain: 0.4 },
    ],
  },
];

/** @type {LoopEntry[]} */
export const ATMOSPHERE_LOOPS = [
  {
    name: "Slow Breathing Atmosphere",
    bpm: 96,
    bars: 2,
    timeSignature: "4/4",
    genres: ["ambient", "lofi", "dubstep"],
    characters: ["dark", "experimental", "roomy"],
    intensity: "low",
    pattern: [
      { source: "sg-one-shot-texture-ambience-0001", steps: [0], gain: 0.7 },
      { source: "sg-one-shot-texture-drone-0001", steps: [16], gain: 0.5 },
    ],
  },
];
