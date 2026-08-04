// Emits src/library/__fixtures__/library.generated.ts — a trimmed slice of the
// real delivered library, for the LOOP-013 browser's unit and component tests.
//
//   node scripts/starter-library/emitBrowserFixtures.mjs          # write
//   node scripts/starter-library/emitBrowserFixtures.mjs --check  # verify fresh
//
// The point of generating it from the same pipeline that writes the real
// delivery (rather than hand-writing a fixture) is that a test parses the exact
// wire shape production parses. `--check` fails when the committed file is stale,
// so a manifest-shape change cannot silently diverge from the tests that assert
// it. The audio itself is never needed here — the fixtures carry metadata only.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAllPacks, buildPackIndex } from "./manifest.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUT_PATH = join(
	REPO_ROOT,
	"src",
	"library",
	"__fixtures__",
	"library.generated.ts",
);

/** Packs the fixtures cover, and how many of each asset type to keep. */
const FIXTURE_PACK_SLUGS = [
	"core-electronic-drums",
	"foundation-bass",
	"tonal-elements",
	"ambient-textures",
];
const ONE_SHOTS_PER_PACK = 5;
const LOOPS_PER_PACK = 1;
const PRESETS_PER_PACK = 1;

export function buildFixtures(packManifests = buildAllPacks().packManifests) {
	const trimmed = FIXTURE_PACK_SLUGS.map((slug) => {
		const pack = packManifests.find((pm) => pm.pack.slug === slug);
		if (!pack) throw new Error(`fixture pack "${slug}" not in the library`);
		const oneShots = pack.assets
			.filter((asset) => asset.type === "one-shot")
			.slice(0, ONE_SHOTS_PER_PACK);
		const loops = pack.assets
			.filter((asset) => asset.type === "loop")
			.slice(0, LOOPS_PER_PACK);
		// A preset carries `audio: null` and no master audio, exercising the
		// browser's preset path (its type filter and its "no audio" handling).
		const presets = pack.assets
			.filter((asset) => asset.type === "preset")
			.slice(0, PRESETS_PER_PACK);
		const assets = [...oneShots, ...loops, ...presets];
		return {
			...pack,
			pack: { ...pack.pack, assetCount: assets.length },
			assets,
		};
	});
	const index = buildPackIndex(trimmed);
	const manifests = Object.fromEntries(trimmed.map((pm) => [pm.pack.slug, pm]));
	return { index, manifests };
}

export function renderModule(packManifests) {
	const { index, manifests } = buildFixtures(packManifests);
	const banner =
		"// GENERATED FIXTURE — do not edit.\n" +
		"//\n" +
		"// A trimmed slice of the real delivered library, emitted from\n" +
		"// scripts/starter-library/manifest.mjs so unit and component tests parse the\n" +
		"// exact wire shape production parses, without a rendered public/samples tree.\n" +
		"// Regenerate with: node scripts/starter-library/emitBrowserFixtures.mjs\n\n";
	return (
		banner +
		`export const FIXTURE_PACK_INDEX = ${JSON.stringify(index)} as const;\n\n` +
		`export const FIXTURE_PACK_MANIFESTS: Record<string, unknown> = ${JSON.stringify(manifests)};\n`
	);
}

function main(argv) {
	const check = argv.includes("--check");
	const source = renderModule();
	if (check) {
		const committed = existsSync(OUT_PATH)
			? readFileSync(OUT_PATH, "utf8")
			: null;
		if (committed !== source) {
			throw new Error(
				"src/library/__fixtures__/library.generated.ts is stale. Run `node scripts/starter-library/emitBrowserFixtures.mjs`.",
			);
		}
		console.log("browser library fixtures are up to date");
		return;
	}
	writeFileSync(OUT_PATH, source);
	console.log(`wrote ${OUT_PATH.replace(`${REPO_ROOT}/`, "")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main(process.argv.slice(2));
}
