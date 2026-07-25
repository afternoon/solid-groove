import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CATALOG } from "./catalog/index.mjs";
import { buildAsset, serialize } from "./manifest.mjs";
import { GENRES, TAXONOMY } from "./taxonomy.mjs";
import {
	BALANCE,
	MAX_MANIFEST_GZIP_BYTES,
	validateManifest,
} from "./validate.mjs";
import { storageKeyFor } from "./wav.mjs";

// Rendering all 200 assets takes ~20s, which is too slow for the suite that
// runs on every save. The full catalogue is rendered and validated by
// `bun run library:validate` in CI; here we render a few representative assets
// and drive the validation rules with fixtures.
const SAMPLE_IDS = [
	"sg-one-shot-drums-kick-0001",
	"sg-one-shot-drums-closed-hat-0002",
	"sg-one-shot-bass-sub-0001",
	"sg-one-shot-tonal-chord-0001",
	"sg-one-shot-fx-glitch-0001",
];

const sampleEntries = SAMPLE_IDS.map((id) => {
	const entry = CATALOG.find((asset) => asset.id === id);
	if (!entry) throw new Error(`test fixture references a missing asset: ${id}`);
	return entry;
});

describe("buildAsset", () => {
	it("is deterministic: the same entry renders byte-identical audio", () => {
		for (const entry of sampleEntries) {
			const first = buildAsset(entry);
			const second = buildAsset(entry);
			expect(second.bytes.equals(first.bytes)).toBe(true);
			expect(second.asset).toEqual(first.asset);
		}
	});

	it("derives the storage key from the bytes it actually wrote", () => {
		for (const entry of sampleEntries) {
			const { asset, bytes } = buildAsset(entry);
			expect(asset.files.master.bytes).toBe(bytes.length);
			expect(asset.files.master.storageKey).toBe(
				storageKeyFor(asset.files.master.sha256),
			);
		}
	});

	it("records rights, provenance, and a reproducible recipe", () => {
		const { asset } = buildAsset(sampleEntries[0]);
		expect(asset.license).toMatchObject({
			creator: "Solid Groove",
			rawRedistributionAllowed: true,
			evidencePath: "docs/licenses/starter-library-v1.md",
		});
		expect(asset.provenance.sourceType).toBe("synthesized");
		expect(asset.provenance.recipe.voice).toBe("kick");
		expect(asset.provenance.recipe.seed).toBeTypeOf("number");
		// Not `approved`: no human has run the section 11 musical review.
		expect(asset.provenance.reviewState).toBe("metadata-review");
	});

	it("describes tonal and unpitched assets differently", () => {
		const chord = buildAsset(sampleEntries[3]).asset;
		expect(chord.audio.rootNote).toBe("C3");
		expect(chord.audio.tuningCents).toBe(0);
		const glitch = buildAsset(sampleEntries[4]).asset;
		expect(glitch.audio.rootNote).toBeNull();
		expect(glitch.audio.tuningCents).toBeNull();
		// One-shots never claim a tempo.
		expect(glitch.audio.loopable).toBe(false);
		expect(glitch.audio.bpm).toBeNull();
	});

	it("marks the choke group on hats", () => {
		const hat = buildAsset(sampleEntries[1]).asset;
		expect(hat.audio.chokeGroup).toBe("drums-hat");
		expect(hat.audio.chokeRole).toBe("closed");
	});
});

describe("serialize", () => {
	it("sorts keys so an unchanged library produces an unchanged file", () => {
		expect(serialize({ b: 1, a: { d: 2, c: 3 } })).toBe(
			'{"a":{"c":3,"d":2},"b":1}',
		);
		expect(serialize({ a: { c: 3, d: 2 }, b: 1 })).toBe(
			serialize({ b: 1, a: { d: 2, c: 3 } }),
		);
	});

	it("preserves array order, which carries meaning", () => {
		expect(serialize({ peaks: [3, 1, 2] })).toBe('{"peaks":[3,1,2]}');
	});
});

// --- validation ------------------------------------------------------------

function validAsset(overrides = {}, index = 0) {
	const hash = String(index).padStart(64, "a");
	return {
		id: `sg-one-shot-drums-kick-${String(index + 1).padStart(4, "0")}`,
		version: 1,
		name: `Fixture Asset ${index}`,
		type: "one-shot",
		family: "drums",
		role: "kick",
		files: {
			master: {
				storageKey: storageKeyFor(hash),
				sha256: hash,
				bytes: 1024,
				format: "wav",
			},
		},
		audio: {
			sampleRate: 48000,
			bitDepth: 24,
			channels: 1,
			durationSeconds: 0.5,
			peakDbfs: -1.5,
			rmsDbfs: -14,
			rootNote: null,
			tuningCents: null,
			bpm: null,
			bars: null,
			loopable: false,
			chokeGroup: null,
			chokeRole: null,
		},
		waveform: { buckets: 2, peaks: [-1, 1, -1, 1] },
		tags: {
			genres: [...GENRES],
			characters: ["dry", "experimental"],
			intensity: "medium",
			sourceTypes: ["synthesized"],
		},
		license: {
			id: "solid-groove-owned",
			creator: "Solid Groove",
			sourceUrl: null,
			retrievedAt: "2026-07-25",
			evidencePath: "docs/licenses/starter-library-v1.md",
			rawRedistributionAllowed: true,
			agreementId: null,
		},
		provenance: {
			sourceType: "synthesized",
			recipe: { voice: "kick", params: {}, seed: 1 },
			modifications: [],
			reviewState: "metadata-review",
			reviewer: null,
			reviewedAt: null,
		},
		...overrides,
	};
}

/** A fixture that satisfies the collection-level rules, so per-asset faults isolate cleanly. */
function validManifest(assets) {
	const generated =
		assets ??
		Object.entries(TAXONOMY).flatMap(([family, roles], familyIndex) =>
			roles.map((role, roleIndex) => {
				const index = familyIndex * 20 + roleIndex;
				return validAsset(
					{
						id: `sg-one-shot-${family}-${role}-0001`,
						name: `Fixture ${family} ${role}`,
						family,
						role,
					},
					index,
				);
			}),
		);
	return {
		schemaVersion: 1,
		libraryId: "sg-starter-library",
		libraryVersion: 1,
		releasedAt: "2026-07-25",
		deliveryTier: "starter-test",
		assetCount: generated.length,
		assets: generated,
	};
}

function errorsFor(mutate) {
	const manifest = validManifest();
	mutate(manifest);
	return validateManifest(manifest).errors;
}

describe("validateManifest", () => {
	it("accepts a well-formed manifest", () => {
		const { errors, warnings } = validateManifest(validManifest());
		expect(errors).toEqual([]);
		// The synthesized-library gap is always reported, never silently passed.
		expect(warnings.join(" ")).toMatch(/recorded or field-recorded/);
	});

	// docs/sample-library.md section 9 names each of these as a CI failure.
	it.each([
		[
			"a missing checksum",
			(m) => {
				m.assets[0].files.master.sha256 = "";
			},
			/not a SHA-256/,
		],
		[
			"a storage key that is not content-addressed",
			(m) => {
				m.assets[0].files.master.storageKey = "audio/kick.wav";
			},
			/does not derive from sha256/,
		],
		[
			"absent rights evidence",
			(m) => {
				m.assets[0].license.evidencePath = null;
			},
			/evidencePath is required/,
		],
		[
			"an absent creator",
			(m) => {
				m.assets[0].license.creator = "";
			},
			/creator is required/,
		],
		[
			"unapproved redistribution",
			(m) => {
				m.assets[0].license.rawRedistributionAllowed = false;
			},
			/raw redistribution is not approved/,
		],
		[
			"a missing licence block",
			(m) => {
				m.assets[0].license = undefined;
			},
			/license is required/,
		],
		[
			"invalid audio metadata",
			(m) => {
				m.assets[0].audio.sampleRate = 44100;
			},
			/sampleRate must be 48000/,
		],
		[
			"a silent asset",
			(m) => {
				m.assets[0].audio.peakDbfs = Number.NEGATIVE_INFINITY;
			},
			/asset is silent/,
		],
		[
			"no headroom",
			(m) => {
				m.assets[0].audio.peakDbfs = 0;
			},
			/leaves no headroom/,
		],
		[
			"a tonal asset with no tuning",
			(m) => {
				m.assets[0].audio.rootNote = "C3";
			},
			/missing tuningCents/,
		],
		[
			"a loop with no tempo",
			(m) => {
				m.assets[0].audio.loopable = true;
			},
			/missing bpm\/bars/,
		],
		[
			"a duplicate id",
			(m) => {
				m.assets[1].id = m.assets[0].id;
			},
			/duplicate asset id/,
		],
		[
			"a duplicate name",
			(m) => {
				m.assets[1].name = m.assets[0].name;
			},
			/duplicate name/,
		],
		[
			"byte-identical audio",
			(m) => {
				m.assets[1].files.master.sha256 = m.assets[0].files.master.sha256;
			},
			/byte-identical to/,
		],
		[
			"an unknown role",
			(m) => {
				m.assets[0].role = "kazoo";
			},
			/unknown family\/role/,
		],
		[
			"an unknown genre",
			(m) => m.assets[0].tags.genres.push("polka"),
			/unknown genre/,
		],
		[
			"an unknown character",
			(m) => m.assets[0].tags.characters.push("crunchy"),
			/unknown character/,
		],
		[
			"an unknown intensity",
			(m) => {
				m.assets[0].tags.intensity = "quite";
			},
			/unknown intensity/,
		],
		[
			"a truncated waveform",
			(m) => m.assets[0].waveform.peaks.pop(),
			/waveform peaks do not match/,
		],
		[
			"a missing generation recipe",
			(m) => {
				m.assets[0].provenance.recipe = null;
			},
			/missing its generation recipe/,
		],
		[
			"a wrong asset count",
			(m) => {
				m.assetCount = 3;
			},
			/does not match assets.length/,
		],
	])("rejects %s", (_label, mutate, expected) => {
		expect(errorsFor(mutate).join("\n")).toMatch(expected);
	});

	// Section 3.5: cleared replacements use descriptive names, not third-party
	// product branding, and a familiar filename proves nothing about rights.
	it.each(["Punchy 909 Kick", "Ableton Style Clap", "Amen Break Hit"])(
		"rejects the third-party brand name %s",
		(name) => {
			expect(
				errorsFor((m) => {
					m.assets[0].name = name;
				}).join("\n"),
			).toMatch(/contains third-party branding/);
		},
	);

	it("rejects an empty manifest rather than reporting a healthy library", () => {
		const { errors } = validateManifest({
			schemaVersion: 1,
			libraryId: "x",
			libraryVersion: 1,
			assets: [],
		});
		expect(errors.join("\n")).toMatch(/assets is empty/);
	});
});

describe("collection balance (section 6.4)", () => {
	it("rejects a library with too little experimental material", () => {
		const manifest = validManifest();
		for (const asset of manifest.assets) asset.tags.characters = ["dry"];
		expect(validateManifest(manifest).errors.join("\n")).toMatch(
			/experimental or abrasive/,
		);
	});

	it("rejects a library with too little dry, shapeable material", () => {
		const manifest = validManifest();
		for (const asset of manifest.assets)
			asset.tags.characters = ["experimental"];
		expect(validateManifest(manifest).errors.join("\n")).toMatch(
			/dry or lightly processed/,
		);
	});

	it("rejects a library dominated by one source family", () => {
		const manifest = validManifest();
		const padding = Array.from({ length: 40 }, (_unused, index) =>
			validAsset(
				{
					id: `sg-one-shot-drums-kick-${String(index + 100).padStart(4, "0")}`,
					name: `Pad ${index}`,
				},
				index + 100,
			),
		);
		manifest.assets.push(...padding);
		manifest.assetCount = manifest.assets.length;
		expect(validateManifest(manifest).errors.join("\n")).toMatch(
			/single-family ceiling/,
		);
	});

	it("rejects a library that leaves a required genre unusable", () => {
		const manifest = validManifest();
		for (const asset of manifest.assets) {
			asset.tags.genres = asset.tags.genres.filter(
				(genre) => genre !== "uk-garage",
			);
		}
		expect(validateManifest(manifest).errors.join("\n")).toMatch(
			/genre "uk-garage"/,
		);
	});

	it("rejects a library that leaves a taxonomy role empty", () => {
		const manifest = validManifest();
		manifest.assets = manifest.assets.filter((asset) => asset.role !== "riser");
		manifest.assetCount = manifest.assets.length;
		expect(validateManifest(manifest).errors.join("\n")).toMatch(
			/no assets cover fx\/riser/,
		);
	});

	// Section 12: the browser fetches this before it can search anything.
	it("rejects a metadata payload over the section 12 budget", () => {
		const manifest = validManifest();
		// Incompressible, so the assertion is about the *gzipped* size the
		// budget is written in. A repeated character would compress to nothing.
		const serialized = randomBytes(MAX_MANIFEST_GZIP_BYTES + 65536).toString(
			"base64",
		);
		const { errors, stats } = validateManifest(manifest, { serialized });
		expect(stats.manifestGzipBytes).toBeGreaterThan(MAX_MANIFEST_GZIP_BYTES);
		expect(errors.join("\n")).toMatch(/over the .* budget/);
	});

	it("exposes the thresholds it enforces", () => {
		expect(BALANCE).toMatchObject({
			minExperimentalShare: 0.15,
			minDryShare: 0.3,
			maxSingleRoleShare: 0.2,
		});
	});
});
