import { describe, expect, it } from "vitest";
import {
	FIXTURE_PACK_INDEX_DOC,
	fixtureFetcher,
} from "./__fixtures__/fixtures";
import {
	assetAudioUrl,
	LIBRARY_ROOT,
	PACK_INDEX_PATH,
	packAssets,
	packManifestPath,
	packSummaries,
	parsePackIndex,
	parsePackManifest,
} from "./manifest";

describe("delivery layout", () => {
	it("resolves the pack index and a manifest under the one library root", () => {
		expect(PACK_INDEX_PATH).toBe(`${LIBRARY_ROOT}/packs/index.json`);
		expect(packManifestPath("core-electronic-drums", "1.0.0")).toBe(
			`${LIBRARY_ROOT}/packs/core-electronic-drums/v1.0.0.json`,
		);
	});

	it("builds an asset audio URL from its storage key", () => {
		expect(assetAudioUrl("sha256/ab/cd/abcd.wav")).toBe(
			`/${LIBRARY_ROOT}/audio/sha256/ab/cd/abcd.wav`,
		);
	});
});

describe("parsing the pack index", () => {
	it("parses the delivered index into pack summaries", () => {
		const index = parsePackIndex(FIXTURE_PACK_INDEX_DOC);
		const summaries = packSummaries(index);
		expect(summaries.length).toBeGreaterThan(0);
		for (const summary of summaries) {
			expect(summary.id).toMatch(/^pak_/);
			expect(summary.slug).toMatch(/^[a-z0-9-]+$/);
			expect(summary.manifestPath).toContain(summary.slug);
			expect(summary.assetCount).toBeGreaterThan(0);
		}
	});

	it("rejects an index whose pack id is not a pak_ id", () => {
		expect(() =>
			parsePackIndex({
				schemaVersion: 1,
				generatedAt: "2026-07-25",
				packs: [
					{
						id: "not-a-pack-id",
						slug: "x",
						name: "X",
						version: "1.0.0",
						publisher: "P",
						kind: "factory",
						description: "",
						assetCount: 1,
						manifestPath: "packs/x/v1.0.0.json",
					},
				],
			}),
		).toThrow();
	});
});

describe("parsing a pack manifest", () => {
	it("resolves every asset against its owning pack, pack-qualified", async () => {
		const fetch = fixtureFetcher();
		const raw = await fetch(
			"samples/starter-library/packs/core-electronic-drums/x.json",
		);
		const manifest = parsePackManifest(raw);
		const assets = packAssets(manifest);
		expect(assets.length).toBe(manifest.assets.length);
		for (const asset of assets) {
			expect(asset.packId).toBe(manifest.pack.id);
			expect(asset.packVersion).toBe(manifest.pack.version);
			expect(asset.packSlug).toBe(manifest.pack.slug);
			// A resolvable audio URL under the library root.
			expect(asset.url).toMatch(new RegExp(`^/${LIBRARY_ROOT}/audio/`));
		}
	});

	it("carries the tags a filter needs", async () => {
		const raw = await fixtureFetcher()(
			"samples/starter-library/packs/core-electronic-drums/x.json",
		);
		const assets = packAssets(parsePackManifest(raw));
		const withGenre = assets.find((asset) => asset.genres.length > 0);
		expect(withGenre).toBeDefined();
		expect(assets.every((asset) => typeof asset.role === "string")).toBe(true);
	});

	it("maps the wire types onto the browser's three types", async () => {
		const raw = await fixtureFetcher()(
			"samples/starter-library/packs/core-electronic-drums/x.json",
		);
		const assets = packAssets(parsePackManifest(raw));
		for (const asset of assets) {
			expect(["one-shot", "loop", "preset"]).toContain(asset.type);
		}
	});

	it("parses a preset asset that carries no audio", async () => {
		// A preset has `audio: null` and a JSON master rather than a WAV; it must
		// not fail the manifest — every other asset would be lost with it.
		const raw = await fixtureFetcher()(
			"samples/starter-library/packs/core-electronic-drums/x.json",
		);
		const assets = packAssets(parsePackManifest(raw));
		const preset = assets.find((asset) => asset.type === "preset");
		expect(preset).toBeDefined();
		expect(preset?.durationSeconds).toBeNull();
	});
});
