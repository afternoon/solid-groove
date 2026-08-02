// The named Freesound gaps the alpha library wants filled.
//
// This is the "a person named this, not a spider found it" half of the Freesound
// API path. Each entry is a specific hole in the synthesized + VCSL coverage —
// the classic drum-machine hits (909, 808, 707), a few organic kit pieces, and
// some texture/FX material — expressed as a query plus the taxonomy (family,
// role) and seed tags a match should land under. `library:freesound` runs each
// query with `license:"Creative Commons 0"` (see freesoundApi.mjs) so only CC0
// sounds ever become candidates.
//
// The role/tags are SEEDS. The curator confirms or corrects them per sound in
// `library:manage`, exactly like an FSLD candidate — the difference is the
// licence is already CC0, so the review is about musical quality and provenance
// (section 3.3), not about hunting for the CC0 needles.
//
// Adding a gap is a content-coverage decision, not a rights one: it cannot widen
// what is bundleable (the API filter and the section 3.2 allowlist still gate
// that), only what a curator is pointed at. Keep the list short and specific —
// a vague query ("drums") reintroduces exactly the noise this path removes.

/**
 * @typedef {object} Gap
 * @property {string} id            Stable slug; becomes part of each candidate id.
 * @property {string} query         The Freesound full-text query.
 * @property {string} family        Taxonomy family the matches seed into.
 * @property {string} role          Taxonomy role the matches seed into.
 * @property {string[]} genres      Seed genre tags (controlled vocabulary).
 * @property {string[]} characters  Seed character tags.
 * @property {string} [intensity]   Seed intensity; defaults to "medium".
 * @property {number} [minDuration] Min seconds (defaults in freesoundApi).
 * @property {number} [maxDuration] Max seconds (defaults in freesoundApi).
 * @property {string} [sort]        Freesound sort; defaults to "score".
 * @property {string[]} [extraFilters] Extra Freesound filter clauses.
 * @property {string} [note]        Why this sound is wanted; shown to the curator.
 */

/** One-shots are short; keep drum hits tight so long loops do not crowd them in. */
const ONE_SHOT = { minDuration: 0.05, maxDuration: 4 };

/** @type {Gap[]} */
export const GAPS = [
	// --- Classic drum-machine hits (the sounds DEC-003 called out) ----------
	{
		id: "tr909-kick",
		query: "909 kick drum",
		family: "drums",
		role: "kick",
		genres: ["house", "techno"],
		characters: ["punchy", "clean"],
		...ONE_SHOT,
		note: "Classic 909 bass drum — the house/techno kick",
	},
	{
		id: "tr909-clap",
		query: "909 clap",
		family: "drums",
		role: "clap",
		genres: ["house", "techno"],
		characters: ["bright", "short"],
		...ONE_SHOT,
		note: "909 hand clap",
	},
	{
		id: "tr909-hat",
		query: "909 hi-hat closed",
		family: "drums",
		role: "closed-hat",
		genres: ["house", "techno"],
		characters: ["bright", "short"],
		...ONE_SHOT,
		note: "909 closed hat",
	},
	{
		id: "tr909-openhat",
		query: "909 open hat",
		family: "drums",
		role: "open-hat",
		genres: ["house", "techno"],
		characters: ["bright", "metallic"],
		...ONE_SHOT,
		note: "909 open hat",
	},
	{
		id: "tr808-kick",
		query: "808 kick boom",
		family: "drums",
		role: "kick",
		genres: ["hip-hop", "trap"],
		characters: ["deep", "sub-heavy"],
		...ONE_SHOT,
		note: "808 boom kick",
	},
	{
		id: "tr808-sub",
		query: "808 bass sub",
		family: "bass",
		role: "sub",
		genres: ["hip-hop", "trap", "dubstep"],
		characters: ["deep", "sub-heavy"],
		...ONE_SHOT,
		note: "Tuned 808 sub bass — the trap/hip-hop low end",
	},
	{
		id: "tr808-snare",
		query: "808 snare",
		family: "drums",
		role: "snare",
		genres: ["hip-hop", "trap"],
		characters: ["tight", "clean"],
		...ONE_SHOT,
		note: "808 snare",
	},
	{
		id: "tr808-rim",
		query: "808 rimshot",
		family: "drums",
		role: "rim",
		genres: ["hip-hop", "house"],
		characters: ["short", "clean"],
		...ONE_SHOT,
		note: "808 rimshot",
	},
	{
		id: "tr707-percussion",
		query: "707 percussion",
		family: "drums",
		role: "percussion",
		genres: ["house", "techno"],
		characters: ["clean", "short"],
		...ONE_SHOT,
		note: "707 percussion hits",
	},
	// --- Organic kit pieces synthesis reaches less convincingly -------------
	{
		id: "rimshot-acoustic",
		query: "acoustic rimshot one shot",
		family: "drums",
		role: "rim",
		genres: ["lofi", "house"],
		characters: ["organic", "short"],
		...ONE_SHOT,
		note: "Acoustic rimshot for lofi/house",
	},
	{
		id: "shaker",
		query: "shaker one shot percussion",
		family: "drums",
		role: "percussion",
		genres: ["house", "lofi"],
		characters: ["organic", "short"],
		...ONE_SHOT,
		note: "Organic shaker",
	},
	{
		id: "tambourine",
		query: "tambourine hit",
		family: "drums",
		role: "percussion",
		genres: ["house", "lofi"],
		characters: ["organic", "bright"],
		...ONE_SHOT,
		note: "Tambourine",
	},
	// --- Texture / FX material ---------------------------------------------
	{
		id: "vinyl-crackle",
		query: "vinyl crackle noise loop",
		family: "texture",
		role: "ambience",
		genres: ["lofi", "hip-hop"],
		characters: ["organic", "gritty"],
		minDuration: 1,
		maxDuration: 12,
		note: "Vinyl crackle bed for lofi",
	},
	{
		id: "riser-noise",
		query: "noise riser sweep uplifter",
		family: "fx",
		role: "sweep",
		genres: ["techno", "dubstep"],
		characters: ["experimental", "bright"],
		minDuration: 0.5,
		maxDuration: 12,
		note: "Noise riser / uplifter transition",
	},
	{
		id: "impact-hit",
		query: "impact boom cinematic hit",
		family: "fx",
		role: "impact",
		genres: ["dubstep", "ambient"],
		characters: ["deep", "dark"],
		...ONE_SHOT,
		note: "Downbeat impact / boom",
	},
];
