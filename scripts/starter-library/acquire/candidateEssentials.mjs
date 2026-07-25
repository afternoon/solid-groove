// The hand-picked essential sounds, kept out of the generator so a regeneration
// never loses them. These point at real pages on approved CC0 sources. VCSL is no
// longer here — it is bulk-ingested by `library:acquire --vcsl`, not auditioned.

export const ESSENTIALS = [
	{
		id: "freepats-synth-percussion",
		sourceId: "freepats",
		pageUrl: "https://freepats.zenvoid.org/Percussion/electric-percussion.html",
		note: "FreePats CC0 synthesizer percussion bank — extract individual hits (pin the .zip mirror; .7z is unsupported)",
		asset: {
			family: "drums",
			role: "percussion",
			name: "FreePats Synth Percussion 01",
			genres: ["techno", "house"],
			characters: ["clean", "short"],
			intensity: "medium",
			sourceType: "recorded",
		},
		licenseConfidence: "unconfirmed",
	},
	{
		id: "freepats-synth-bass",
		sourceId: "freepats",
		pageUrl: "https://freepats.zenvoid.org/Synthesizer/synth-bass.html",
		note: "FreePats CC0 synth bass multisample — pick a single sustained note as a stab/sustained one-shot",
		asset: {
			family: "bass",
			role: "sustained",
			name: "FreePats Synth Bass C1",
			genres: ["house", "techno", "electronic-pop"],
			characters: ["warm", "round"],
			intensity: "medium",
			sourceType: "recorded",
			rootNote: "C1",
		},
		licenseConfidence: "unconfirmed",
	},
];
