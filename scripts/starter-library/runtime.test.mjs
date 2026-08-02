// CNT-001 acceptance criterion 4: "Runtime and tests consume generated
// manifests rather than hand-maintained duplicate lists."
//
// The committed `src/library/factoryLibrary.generated.ts` is what makes that
// true, and a committed generated file is only as good as the check that it
// still matches its generator. That check is here, in the unit suite, so it
// runs on every `bun run test` rather than only when someone thinks to
// regenerate.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODULE_PATH } from "./emitRuntime.mjs";
import { buildAllPacks } from "./manifest.mjs";
import {
	buildRuntimeLibrary,
	RUNTIME_SELECTION,
	renderRuntimeModule,
	runtimeStorageRef,
} from "./runtime.mjs";

const runtime = buildRuntimeLibrary();

describe("the generated runtime library module", () => {
	it("matches what the pipeline emits today", () => {
		expect(readFileSync(MODULE_PATH, "utf8")).toBe(
			renderRuntimeModule(runtime),
		);
	});

	it("selects assets the full library actually delivers, unchanged", () => {
		// The whole point of the selection is that it is a *view* of the library,
		// not a second copy of it: the same builders, so the same bytes, the same
		// checksum, and the same content-addressed key as the delivered object.
		const delivered = new Map(
			buildAllPacks()
				.packManifests.flatMap((pm) => pm.assets)
				.map((asset) => [asset.id, asset]),
		);
		for (const { asset } of runtime.assets) {
			const full = delivered.get(asset.id);
			expect(full, asset.id).toBeDefined();
			expect(asset.files.master).toEqual(full.files.master);
			expect(asset.pack).toEqual(full.pack);
			expect(asset.name).toBe(full.name);
		}
	}, 60_000);

	it("points the app at the delivery layout, not at a bespoke path", () => {
		for (const { asset } of runtime.assets) {
			expect(runtimeStorageRef(asset.files.master.storageKey)).toBe(
				`samples/starter-library/audio/${asset.files.master.storageKey}`,
			);
		}
	});

	it("emits one audio file per selected asset", () => {
		expect(runtime.files).toHaveLength(RUNTIME_SELECTION.length);
		for (const file of runtime.files) {
			expect(file.bytes.length).toBeGreaterThan(0);
		}
	});

	it("carries no third-party branding into the product", () => {
		// The starter project used to ship a "909 Bass Drum". The manifest
		// validator has always rejected that name; now the app gets its name from
		// the manifest, so it cannot reintroduce one.
		for (const { asset } of runtime.assets) {
			expect(asset.name.toLowerCase()).not.toMatch(/909|808|roland|juno/);
		}
	});
});
