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
import { CATALOG, LOOP_CATALOG } from "./catalog/index.mjs";
import { createRng, seedFromString } from "./dsp.mjs";
import { MODULE_PATH } from "./emitRuntime.mjs";
import { buildAsset, buildLoop } from "./manifest.mjs";
import { renderVoice } from "./voices.mjs";
import {
  buildRuntimeLibrary,
  RUNTIME_SELECTION,
  renderRuntimeModule,
  runtimeStorageRef,
} from "./runtime.mjs";

const runtime = buildRuntimeLibrary();

describe("the generated runtime library module", () => {
  it("matches what the pipeline emits today", () => {
    expect(readFileSync(MODULE_PATH, "utf8")).toBe(renderRuntimeModule(runtime));
  });

  it("selects assets the full library actually delivers, unchanged", () => {
    // The whole point of the selection is that it is a *view* of the library,
    // not a second copy of it: the same builders, so the same bytes, the same
    // checksum, and the same content-addressed key as the delivered object.
    //
    // Rebuild only the selected entries rather than the whole library.
    // `buildAllPacks` renders all ~200 assets — about 20 seconds of additive
    // synthesis — to answer a question about three of them, and what it would
    // compare against is the output of the very same pure `buildAsset` /
    // `buildLoop` calls `buildRuntimeLibrary` makes (see `manifest.mjs`, where
    // `buildAllPacks` maps those two functions over the catalogue). Asserting
    // that a pure function equals itself is not the coverage this test exists
    // for.
    //
    // What it is actually here to catch is the selection drifting away from
    // the catalogue — an ID renamed or retired out from under
    // `RUNTIME_SELECTION`, so the app ships an asset the library no longer
    // delivers. That is a catalogue lookup, which is what this does, and it
    // stays a hard failure.
    const oneShots = new Map(CATALOG.map((entry) => [entry.id, entry]));
    const loops = new Map(LOOP_CATALOG.map((entry) => [entry.id, entry]));
    const renderSource = (id) => {
      const entry = oneShots.get(id);
      if (!entry) throw new Error(`unknown source asset ${id}`);
      return renderVoice(entry, createRng(seedFromString(entry.id)));
    };

    for (const { asset } of runtime.assets) {
      const oneShot = oneShots.get(asset.id);
      const loop = loops.get(asset.id);
      expect(oneShot ?? loop, `${asset.id} is not in the catalogue`).toBeDefined();

      const { asset: full } = oneShot
        ? buildAsset(oneShot)
        : buildLoop(loop, renderSource);
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
