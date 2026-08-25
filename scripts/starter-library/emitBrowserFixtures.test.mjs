// The LOOP-013 browser's unit and component tests parse a committed slice of
// the delivered library (`src/library/__fixtures__/library.generated.ts`). Like
// every generated-and-committed file, it is only as good as the check that it
// still matches its generator — so this runs on every `bun run test` rather
// than only when someone remembers to regenerate.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFixtures, OUT_PATH, renderModule } from "./emitBrowserFixtures.mjs";
import { buildAllPacks } from "./manifest.mjs";

// Rendering the whole library is expensive; do it once for the whole file and
// thread the result through both the fixtures and the module render.
const packManifests = buildAllPacks().packManifests;
const fixtures = buildFixtures(packManifests);
const rendered = renderModule(packManifests);
const deliveredIds = new Set(
  packManifests.flatMap((pm) => pm.assets).map((asset) => asset.id),
);

describe("the generated browser fixtures", () => {
  it("match what the pipeline emits today", () => {
    expect(readFileSync(OUT_PATH, "utf8")).toBe(rendered);
  });

  it("cover more than one pack, each with a one-shot and a loop", () => {
    const slugs = Object.keys(fixtures.manifests);
    expect(slugs.length).toBeGreaterThan(1);
    for (const manifest of Object.values(fixtures.manifests)) {
      const types = new Set(manifest.assets.map((asset) => asset.type));
      expect(types.has("one-shot")).toBe(true);
      expect(types.has("loop")).toBe(true);
    }
  });

  it("include at least one preset overall, for the null-audio path", () => {
    // Not every pack has presets (only some do), but the browser's null-audio
    // handling needs at least one somewhere in the fixtures.
    const types = new Set(
      Object.values(fixtures.manifests).flatMap((manifest) =>
        manifest.assets.map((asset) => asset.type),
      ),
    );
    expect(types.has("preset")).toBe(true);
  });

  it("stay a faithful slice — every fixture asset is in the real delivery", () => {
    for (const manifest of Object.values(fixtures.manifests)) {
      for (const asset of manifest.assets) {
        expect(deliveredIds.has(asset.id)).toBe(true);
      }
    }
  });
});
