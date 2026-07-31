// Presets and derived masters (docs/sample-library.md sections 5 "Asset types"
// and 10 "Master files"/"Sampled instruments").
//
// A preset carries no audio: it is a mapping from pad or key ranges onto
// *pack-qualified asset IDs*, "never filenames or URLs" (section 9's controlled
// vocabulary). It is still delivered as a content-addressed object through the
// same manifest, validator, delivery layout, and uploader as a WAV — the only
// difference is that its master is `.json` rather than `.wav`, which is what
// keeps there being one pipeline instead of two.
//
// A derived master names the asset it was produced from, the transform, and the
// source's checksum, so section 10's "keep a checksum of the untouched source
// and treat processed masters as derived assets" is a record in the manifest
// rather than a convention.
//
// Both are append-only for the same reason the one-shot groups are.

/**
 * @typedef {object} PresetEntry
 * @property {string} name          User-facing name.
 * @property {string} family        Owning family — decides the pack.
 * @property {string} kind          drum-kit | instrument | device-chain.
 * @property {string[]} genres      Genre IDs from the controlled vocabulary.
 * @property {string[]} characters  Character tags from the controlled vocabulary.
 * @property {string} intensity     low | medium | high | extreme.
 * @property {object} definition    Kind-specific body; asset references only.
 */

/** @type {PresetEntry[]} */
export const DRUM_KITS = [
	{
		name: "Club Foundation Kit",
		family: "drums",
		kind: "drum-kit",
		genres: ["house", "uk-garage", "electronic-pop"],
		characters: ["clean", "punchy", "dry"],
		intensity: "medium",
		definition: {
			pads: [
				{ pad: 1, role: "kick", assetId: "sg-one-shot-drums-kick-0001" },
				{ pad: 2, role: "snare", assetId: "sg-one-shot-drums-snare-0001" },
				{ pad: 3, role: "clap", assetId: "sg-one-shot-drums-clap-0001" },
				{ pad: 4, role: "rim", assetId: "sg-one-shot-drums-rim-0001" },
				{
					pad: 5,
					role: "closed-hat",
					assetId: "sg-one-shot-drums-closed-hat-0001",
				},
				{
					pad: 6,
					role: "open-hat",
					assetId: "sg-one-shot-drums-open-hat-0001",
				},
				{ pad: 7, role: "tom", assetId: "sg-one-shot-drums-tom-0001" },
				{ pad: 8, role: "cymbal", assetId: "sg-one-shot-drums-cymbal-0001" },
			],
		},
	},
	{
		name: "Industrial Techno Kit",
		family: "drums",
		kind: "drum-kit",
		genres: ["techno", "breakbeat"],
		characters: ["dark", "abrasive", "metallic"],
		intensity: "high",
		definition: {
			pads: [
				{ pad: 1, role: "kick", assetId: "sg-one-shot-drums-kick-0002" },
				{ pad: 2, role: "snare", assetId: "sg-one-shot-drums-snare-0002" },
				{ pad: 3, role: "rim", assetId: "sg-one-shot-drums-rim-0002" },
				{
					pad: 4,
					role: "closed-hat",
					assetId: "sg-one-shot-drums-closed-hat-0002",
				},
				{
					pad: 5,
					role: "open-hat",
					assetId: "sg-one-shot-drums-open-hat-0002",
				},
				{
					pad: 6,
					role: "percussion",
					assetId: "sg-one-shot-drums-percussion-0002",
				},
			],
		},
	},
];

/**
 * Multisample instruments (section 10, "Sampled instruments").
 *
 * Zones name a root note and the key range they cover as MIDI numbers. The
 * validator checks that the zones of one instrument are contiguous, do not
 * overlap, contain their own root, and reference assets that exist and are
 * genuinely tonal — the "validate root keys, zone boundaries" rule, expressed
 * as data rather than as a review instruction.
 */
/** @type {PresetEntry[]} */
export const INSTRUMENTS = [
	{
		name: "Tine Keys Instrument",
		family: "tonal",
		kind: "instrument",
		genres: ["lofi", "house", "electronic-pop"],
		characters: ["warm", "soft", "clean"],
		intensity: "low",
		definition: {
			zones: [
				{
					assetId: "sg-one-shot-tonal-key-0001",
					rootNote: "C3",
					lowNote: 36,
					highNote: 50,
				},
				{
					assetId: "sg-one-shot-tonal-key-0002",
					rootNote: "F3",
					lowNote: 51,
					highNote: 55,
				},
				{
					assetId: "sg-one-shot-tonal-key-0003",
					rootNote: "A3",
					lowNote: 56,
					highNote: 59,
				},
				{
					assetId: "sg-one-shot-tonal-key-0004",
					rootNote: "D4",
					lowNote: 60,
					highNote: 96,
				},
			],
		},
	},
	{
		name: "Struck Bells Instrument",
		family: "tonal",
		kind: "instrument",
		genres: ["ambient", "trance", "electronic-pop"],
		characters: ["glassy", "bright", "resonant"],
		intensity: "low",
		definition: {
			zones: [
				{
					assetId: "sg-one-shot-tonal-bell-0002",
					rootNote: "D3",
					lowNote: 36,
					highNote: 57,
				},
				{
					assetId: "sg-one-shot-tonal-bell-0003",
					rootNote: "F4",
					lowNote: 58,
					highNote: 72,
				},
				{
					assetId: "sg-one-shot-tonal-bell-0001",
					rootNote: "A5",
					lowNote: 73,
					highNote: 96,
				},
			],
		},
	},
];

/**
 * Device chains reference no audio at all — section 5 is explicit that a device
 * preset "contains no third-party audio unless separately licensed" — so they
 * are the cheapest proof that the manifest carries a preset whose body is pure
 * parameter values.
 */
/** @type {PresetEntry[]} */
export const DEVICE_CHAINS = [
	{
		name: "Dry Drum Bus Chain",
		family: "fx",
		kind: "device-chain",
		genres: ["house", "techno", "breakbeat"],
		characters: ["dry", "tight", "punchy"],
		intensity: "medium",
		definition: {
			devices: [
				{ type: "eq", parameters: { highPassHz: 30, lowShelfDb: 1.5 } },
				{ type: "compressor", parameters: { thresholdDb: -12, ratio: 3 } },
			],
		},
	},
	{
		name: "Wide Texture Chain",
		family: "texture",
		kind: "device-chain",
		genres: ["ambient", "dubstep", "lofi"],
		characters: ["roomy", "experimental", "layered"],
		intensity: "low",
		definition: {
			devices: [
				{ type: "reverb", parameters: { decaySeconds: 4.5, mix: 0.4 } },
				{ type: "delay", parameters: { timeSeconds: 0.375, feedback: 0.35 } },
			],
		},
	},
];

/**
 * @typedef {object} DerivedEntry
 * @property {string} name          User-facing name.
 * @property {string} sourceId      Catalogue ID of the untouched master.
 * @property {string} transform     From `DERIVATIONS`.
 * @property {string[]} genres      Genre IDs from the controlled vocabulary.
 * @property {string[]} characters  Character tags from the controlled vocabulary.
 * @property {string} intensity     low | medium | high | extreme.
 */

/** @type {DerivedEntry[]} */
export const DERIVED = [
	{
		name: "Reversed Room Ambience",
		sourceId: "sg-one-shot-texture-ambience-0001",
		transform: "reverse",
		genres: ["ambient", "dubstep", "lofi"],
		characters: ["experimental", "roomy", "dark"],
		intensity: "low",
	},
	{
		name: "Reversed Crash Swell",
		sourceId: "sg-one-shot-drums-cymbal-0001",
		transform: "reverse",
		genres: ["house", "trance", "electronic-pop"],
		characters: ["bright", "experimental", "long"],
		intensity: "medium",
	},
	{
		name: "Half Speed Cavern",
		sourceId: "sg-one-shot-texture-ambience-0002",
		transform: "half-speed",
		genres: ["ambient", "dubstep", "techno"],
		characters: ["dark", "experimental", "long"],
		intensity: "low",
	},
	{
		name: "Octave Down Sub Pull",
		sourceId: "sg-one-shot-bass-sub-0001",
		transform: "octave-down",
		genres: ["dubstep", "drum-and-bass", "techno"],
		characters: ["sub-heavy", "deep", "dry"],
		intensity: "high",
	},
];
