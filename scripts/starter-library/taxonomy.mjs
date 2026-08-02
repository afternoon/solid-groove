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

/**
 * The section 5 "Asset types" list, as the `type` discriminator a manifest
 * entry carries.
 *
 * `CNT-000`/`CNT-000b` shipped `one-shot` only. `CNT-001` generalizes the
 * pipeline to the rest of the section 5 list without forking it: a loop, a
 * preset (drum kit, multisample instrument, or device chain), and a derived
 * master all flow through the same catalogue, manifest, validator, delivery
 * layout, and uploader, and differ only in the type-specific block they carry.
 */
export const ASSET_TYPES = ["one-shot", "loop", "preset", "derived"];

/**
 * Loop roles, per family (section 6.3's loop allocation, section 10's "Loops").
 *
 * Deliberately a separate tree from the one-shot `TAXONOMY`: a loop's role
 * describes a *phrase* ("top loop", "bassline"), not a single hit, and reusing
 * the one-shot roles would make `drums/kick` mean two different things
 * depending on the type — which the browser's role filter cannot show.
 */
export const LOOP_TAXONOMY = {
	drums: ["full-loop", "top-loop", "percussion-loop"],
	bass: ["bassline"],
	tonal: ["chord-loop", "melodic-loop"],
	texture: ["atmosphere-loop"],
};

/** Loop time signatures the grid checker accepts. */
export const TIME_SIGNATURES = ["4/4", "3/4", "6/8", "7/8"];

/**
 * Preset kinds (section 5 "Asset types"). A preset carries no audio of its own;
 * it references pack-qualified asset IDs, "never filenames or URLs" (section 9
 * controlled vocabulary), which is what the reference check in `validate.mjs`
 * enforces.
 */
export const PRESET_KINDS = ["drum-kit", "instrument", "device-chain"];

/**
 * Transforms a derived master may declare (section 10, "Keep a checksum of the
 * untouched source and treat processed masters as derived assets"). A derived
 * asset names its source asset and one of these, so the whole chain from
 * catalogue recipe to delivered bytes stays auditable.
 */
export const DERIVATIONS = ["reverse", "half-speed", "octave-down"];

export function isKnownRole(family, role) {
	return TAXONOMY[family]?.includes(role) ?? false;
}

export function isKnownLoopRole(family, role) {
	return LOOP_TAXONOMY[family]?.includes(role) ?? false;
}

/**
 * The role vocabulary for one asset type. The validator uses this rather than
 * branching on the type in three places, so adding a type means adding its
 * roles here and nothing else.
 */
export function isKnownRoleForType(type, family, role) {
	if (type === "loop") return isKnownLoopRole(family, role);
	if (type === "preset") return PRESET_KINDS.includes(role);
	// A derived master keeps its source's family and role, so it is checked
	// against whichever tree that source came from.
	if (type === "derived")
		return isKnownRole(family, role) || isKnownLoopRole(family, role);
	return isKnownRole(family, role);
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
