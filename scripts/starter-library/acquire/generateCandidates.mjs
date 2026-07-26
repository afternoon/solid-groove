#!/usr/bin/env node
// Generate `candidates.json` from the mined source data.
//
//   node scripts/starter-library/acquire/generateCandidates.mjs
//
// The candidate list is large (~1000 entries), so it is generated rather than
// hand-edited: the inputs in `candidate-sources/` come from real, enumerable CC0
// (or per-item CC-licensed) collections, and this turns them into candidate
// *pages* the management tool can audition. It fabricates nothing — every
// pageUrl is built from a real instrument folder or a real Freesound sound ID.
//
// This is not a crawler and does not run during the tool. It is a one-off, rerun
// by hand when the mined inputs change, and its output is committed. The
// management tool reads the committed `candidates.json`, never this script.
//
// Provenance of the inputs (all captured under candidate-sources/):
//   fsld-loops.json — the Freesound Loop Dataset (Zenodo 3967852) annotation
//     subset: real Freesound sound IDs with BPM/key/genre/instrumentation. The
//     per-sound licence lives only inside the 8.8 GB archive, so these are
//     `unconfirmed`: the reviewer confirms CC0 on each Freesound page in the
//     tool. Vocal-flagged and discarded loops are already filtered out.
//   FreePats banks and a small hand-picked essential set are declared inline
//     below, because they are a short list, not a mined table.
//
// VCSL is deliberately NOT a candidate source: the whole repository is CC0, so
// it is bulk-ingested by `acquire/vcsl.mjs` (library:acquire --vcsl) rather than
// reviewed page-by-page here.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES_DIR = join(HERE, "candidate-sources");
const OUT_PATH = join(HERE, "candidates.json");

/** Cap FSLD so mined loops do not swamp the curated one-shot material. */
const FSLD_LIMIT = 984;

const slug = (text) =>
	text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

// --- FSLD (Freesound Loop Dataset) ---------------------------------------

// The dataset genre strings are free text; map the common ones onto the
// controlled vocabulary and drop the rest (the reviewer sets final tags anyway).
const FSLD_GENRE_MAP = {
	"house / techno": ["house", "techno"],
	house: ["house"],
	techno: ["techno"],
	"drum and bass": ["drum-and-bass"],
	"drum & bass": ["drum-and-bass"],
	dnb: ["drum-and-bass"],
	jungle: ["jungle"],
	dubstep: ["dubstep"],
	"bass music": ["dubstep"],
	"hip hop": ["hip-hop"],
	"hip-hop": ["hip-hop"],
	trap: ["trap"],
	ambient: ["ambient"],
	lofi: ["lofi"],
	"lo-fi": ["lofi"],
	trance: ["trance"],
	breakbeat: ["breakbeat"],
	electronic: ["electronic-pop"],
	pop: ["electronic-pop"],
};

function mapFsldGenres(genres) {
	const mapped = new Set();
	for (const g of genres) {
		for (const key of FSLD_GENRE_MAP[String(g).toLowerCase()] ?? [])
			mapped.add(key);
	}
	return [...mapped];
}

// Instrumentation flags -> a one-shot role. These are loops, so the mapping is
// approximate; the reviewer confirms it. Order matters: percussion wins over a
// co-flagged melody because a drum loop is the more useful default.
function mapFsldRole(inst) {
	if (inst.includes("percussion"))
		return { family: "drums", role: "percussion", characters: ["organic"] };
	if (inst.includes("bass"))
		return { family: "bass", role: "sustained", characters: ["warm"] };
	if (inst.includes("chords"))
		return { family: "tonal", role: "chord", characters: ["warm"] };
	if (inst.includes("melody"))
		return { family: "tonal", role: "pluck", characters: ["clean"] };
	if (inst.includes("fx"))
		return { family: "fx", role: "sweep", characters: ["experimental"] };
	return { family: "texture", role: "ambience", characters: ["organic"] };
}

function fsldCandidates() {
	const { loops } = JSON.parse(
		readFileSync(join(SOURCES_DIR, "fsld-loops.json"), "utf8"),
	);
	const out = [];
	for (const loop of loops) {
		if (out.length >= FSLD_LIMIT) break;
		const mapped = mapFsldRole(loop.inst ?? []);
		const genres = mapFsldGenres(loop.genres ?? []);
		const bpm = loop.bpm ? ` ${loop.bpm} BPM` : "";
		out.push({
			id: `freesound-fsld-${loop.id}`,
			sourceId: "freesound",
			pageUrl: `https://freesound.org/s/${loop.id}/`,
			note: `FSLD loop${bpm}${loop.key && loop.key !== "none" ? ` · key ${loop.key} ${loop.mode ?? ""}`.trimEnd() : ""} — confirm CC0 on the page`,
			licenseConfidence: "unconfirmed",
			asset: {
				family: mapped.family,
				role: mapped.role,
				name: `Freesound Loop ${loop.id}`,
				// Guarantee at least one genre tag (the draft validator needs one).
				genres: genres.length ? genres : ["electronic-pop"],
				characters: mapped.characters,
				intensity: "medium",
				sourceType: "recorded",
			},
		});
	}
	return out;
}

// --- FreePats banks -------------------------------------------------------

// Short enough to declare inline. Licences vary per bank, so `unconfirmed`.
const FREEPATS_BANKS = [
	[
		"electric-percussion",
		"Percussion/electric-percussion.html",
		"drums",
		"percussion",
		["techno", "house"],
	],
	[
		"acoustic-drum-kit",
		"Percussion/acoustic-drum-kit.html",
		"drums",
		"percussion",
		["house", "breakbeat"],
	],
	[
		"world-percussion",
		"Percussion/world-and-rare-percussion.html",
		"drums",
		"percussion",
		["ambient", "house"],
	],
	[
		"orchestral-percussion",
		"Percussion/orchestral-percussion.html",
		"drums",
		"percussion",
		["ambient"],
	],
	[
		"synth-bass",
		"Synthesizer/synth-bass.html",
		"bass",
		"sustained",
		["house", "techno"],
	],
	[
		"synth-lead",
		"Synthesizer/synth-lead.html",
		"tonal",
		"pluck",
		["trance", "techno"],
	],
	[
		"synth-pad",
		"Synthesizer/synth-pad.html",
		"texture",
		"drone",
		["ambient", "trance"],
	],
	[
		"synth-strings",
		"Synthesizer/synth-strings.html",
		"tonal",
		"chord",
		["ambient", "trance"],
	],
	["synth-brass", "Synthesizer/synth-brass.html", "tonal", "stab", ["house"]],
	[
		"synth-effects",
		"Synthesizer/synth-effects.html",
		"fx",
		"sweep",
		["techno", "dubstep"],
	],
	[
		"glass",
		"ChromaticPercussion/glass.html",
		"tonal",
		"bell",
		["ambient", "lofi"],
	],
	[
		"hang",
		"ChromaticPercussion/hang.html",
		"tonal",
		"mallet",
		["ambient", "lofi"],
	],
	[
		"tubular-bells",
		"ChromaticPercussion/tubular-bells.html",
		"tonal",
		"bell",
		["ambient"],
	],
	[
		"xylophone",
		"ChromaticPercussion/xylophone.html",
		"tonal",
		"mallet",
		["lofi", "house"],
	],
	[
		"synthesized-piano",
		"ElectricPiano/synthesized-piano.html",
		"tonal",
		"key",
		["lofi", "house"],
	],
];

function freepatsCandidates() {
	return FREEPATS_BANKS.map(([id, path, family, role, genres]) => ({
		id: `freepats-${id}`,
		sourceId: "freepats",
		pageUrl: `https://freepats.zenvoid.org/${path}`,
		note: `FreePats ${id.replace(/-/g, " ")} bank — confirm the bank states CC0, extract one member`,
		licenseConfidence: "unconfirmed",
		asset: {
			family,
			role,
			name: `FreePats ${id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
			genres,
			characters: ["clean"],
			intensity: "medium",
			sourceType: "recorded",
		},
	}));
}

// --- Essential hand-picked set -------------------------------------------

// The original curated essentials (a 909 kick, an 808, hat pairs, …). These use
// placeholder Freesound IDs the reviewer replaces with a specific audited CC0
// sound. Kept verbatim so the essentials survive a regeneration.
import { ESSENTIALS } from "./candidateEssentials.mjs";

function generate() {
	const groups = [
		["essentials", ESSENTIALS],
		["freepats", freepatsCandidates()],
		["fsld", fsldCandidates()],
	];

	const seen = new Set();
	const candidates = [];
	for (const [, group] of groups) {
		for (const candidate of group) {
			if (seen.has(candidate.id)) continue;
			seen.add(candidate.id);
			candidates.push(candidate);
		}
	}

	const header = {
		version: 1,
		_comment:
			"GENERATED by acquire/generateCandidates.mjs — do not hand-edit. Curated candidate sample PAGES for `bun run library:manage`. This is NOT a pin list and NOT a search: every entry is a specific page a reviewer auditions before anything is written. licenseConfidence is a review-order hint, never a rights decision — verify CC0 on each page. Sources: hand-picked essentials, FreePats banks (per-bank licence), and the Freesound Loop Dataset annotation subset (real IDs, licence confirmed per page). VCSL is not here — it is a trusted bulk CC0 source ingested by `library:acquire --vcsl`.",
		generatedFrom: {
			fsld: "candidate-sources/fsld-loops.json (Zenodo 3967852 annotations)",
		},
		candidates,
	};
	writeFileSync(OUT_PATH, `${JSON.stringify(header, null, "\t")}\n`);

	const byConfidence = {};
	const bySource = {};
	for (const c of candidates) {
		byConfidence[c.licenseConfidence] =
			(byConfidence[c.licenseConfidence] ?? 0) + 1;
		bySource[c.sourceId] = (bySource[c.sourceId] ?? 0) + 1;
	}
	return { total: candidates.length, byConfidence, bySource };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const stats = generate();
	console.log(`wrote ${stats.total} candidates to ${OUT_PATH}`);
	console.log("by confidence:", stats.byConfidence);
	console.log("by source:", stats.bySource);
}

export { generate, mapFsldRole, fsldCandidates };
