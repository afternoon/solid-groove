// The controlled vocabulary from docs/sample-library.md sections 5 and 9.
//
// The catalogue, the manifest, and the validator all read these lists, so a
// typo in a tag is a build failure rather than a category that silently never
// appears in the library browser.

/** The one-shot tree from section 5: family, then functional role. */
export const TAXONOMY = {
	drums: [
		"kick",
		"snare",
		"clap",
		"rim",
		"closed-hat",
		"open-hat",
		"cymbal",
		"tom",
		"percussion",
	],
	bass: ["sub", "sustained", "stab", "reese"],
	tonal: ["chord", "stab", "pluck", "key", "mallet", "bell"],
	texture: ["noise", "ambience", "drone", "mechanical", "organic"],
	fx: ["impact", "riser", "downer", "sweep", "reverse", "glitch"],
};

export const FAMILIES = Object.keys(TAXONOMY);

export function isKnownRole(family, role) {
	return TAXONOMY[family]?.includes(role) ?? false;
}

/**
 * Genre IDs. Stable and many-to-many: a tag improves discovery, it never
 * restricts where an asset can be used (PRD LIB-02, library principle 3).
 *
 * Covers every genre PRD LIB-02 names as required.
 */
export const GENRES = [
	"house",
	"techno",
	"hip-hop",
	"trap",
	"drum-and-bass",
	"jungle",
	"dubstep",
	"ambient",
	"lofi",
	"trance",
	"uk-garage",
	"breakbeat",
	"electronic-pop",
];

/** Audible qualities, kept separate from genre and from mood. */
export const CHARACTERS = [
	"abrasive",
	"bright",
	"clean",
	"dark",
	"deep",
	"distorted",
	"dry",
	"experimental",
	"glassy",
	"gritty",
	"layered",
	"long",
	"metallic",
	"noisy",
	"organic",
	"punchy",
	"resonant",
	"roomy",
	"round",
	"short",
	"soft",
	"sub-heavy",
	"tight",
	"tuned",
	"warm",
	"wooden",
];

export const INTENSITIES = ["low", "medium", "high", "extreme"];

/**
 * Source types. This generated library is entirely `synthesized`; the other
 * values exist because the same manifest shape carries recorded and
 * commissioned content when `CNT-002` adds it.
 */
export const SOURCE_TYPES = [
	"synthesized",
	"recorded",
	"field-recording",
	"resampled",
	"processed",
	"commissioned",
];

/**
 * Characters that count towards the section 6.4 "leave room for accidents"
 * floor: at least 15% of the collection must be explicitly experimental,
 * abrasive, unstable-sounding, or cross-genre.
 */
export const EXPERIMENTAL_CHARACTERS = ["experimental", "abrasive"];

/**
 * Characters that count as dry or lightly processed for the section 6.4 floor
 * of 30%: material the user can still shape substantially.
 */
export const DRY_CHARACTERS = ["dry", "clean", "tight"];
