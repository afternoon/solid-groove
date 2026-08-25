// CNT-001: the ingestion pipeline generalized past one-shots.
//
// Every rule here is one the acceptance criteria name — stable IDs and required
// searchable metadata for one-shots, loops, presets, and derived files; CI
// rejecting duplicate IDs, absent licences, invalid audio metadata, broken
// paths, loop seams, unapproved redistribution policy, and an asset licence
// exceeding its pack's rights position; the same pipeline producing pack
// records, per-pack manifests, and a pack index for every type.
//
// The negative cases mutate a *real* built asset rather than a hand-written
// literal, so a rule cannot pass because the fixture forgot the field it checks.

import { describe, expect, it } from "vitest";
import {
  CATALOG,
  DERIVED_CATALOG,
  LOOP_CATALOG,
  PRESET_CATALOG,
} from "./catalog/index.mjs";
import { createRng, seedFromString } from "./dsp.mjs";
import {
  DELIVERABLE_STATES,
  formatWithheldReport,
  INTAKE_STATES,
  isDeliverable,
  partitionByIntake,
  withheldReason,
} from "./intake.mjs";
import {
  analyzeSeam,
  loopFrames,
  renderLoop,
  SEAM_CYCLES,
  verifyGrid,
} from "./loops.mjs";
import {
  buildAllPacks,
  buildDerived,
  buildLoop,
  buildPackIndex,
  buildPreset,
  serialize,
} from "./manifest.mjs";
import { packBySlug } from "./packs.mjs";
import { ASSET_TYPES } from "./taxonomy.mjs";
import {
  validateLibraryReferences,
  validatePackIndex,
  validatePackManifest,
} from "./validate.mjs";
import { renderVoice } from "./voices.mjs";
import { storageKeyFor } from "./wav.mjs";

/** Built once: rendering the library is the expensive part of this suite. */
const library = buildAllPacks();
const allAssets = library.packManifests.flatMap((pm) => pm.assets);
const byId = new Map(allAssets.map((asset) => [asset.id, asset]));

function assetOfType(type) {
  const asset = allAssets.find((candidate) => candidate.type === type);
  if (!asset) throw new Error(`the build produced no ${type}`);
  return asset;
}

/** Validate a mutated copy of one built pack manifest. */
function errorsForPack(slug, mutate) {
  const source = structuredClone(
    library.packManifests.find((pm) => pm.pack.slug === slug),
  );
  mutate(source);
  source.pack.assetCount = source.assets.length;
  return validatePackManifest(source).errors;
}

/**
 * The drum pack is the one that holds all four asset types, so it is where the
 * per-type negative cases are exercised unless a rule needs another pack.
 */
function errorsFor(mutate) {
  return errorsForPack("core-electronic-drums", mutate);
}

describe("asset types (LIB-01, sample-library section 5)", () => {
  it("delivers a one-shot, a loop, a preset, and a derived master", () => {
    const produced = new Set(allAssets.map((asset) => asset.type));
    expect([...produced].sort()).toEqual([...ASSET_TYPES].sort());
  });

  it("gives every type a stable, type-qualified, unique ID", () => {
    const seen = new Set();
    for (const asset of allAssets) {
      expect(asset.id, asset.name).toMatch(
        /^sg-(one-shot|loop|preset|derived)-[a-z]+-[a-z-]+-\d{4}$/,
      );
      expect(asset.id.startsWith(`sg-${asset.type}-`), asset.id).toBe(true);
      expect(seen.has(asset.id), `${asset.id} is not unique`).toBe(false);
      seen.add(asset.id);
    }
  });

  it("gives every type an owning pack and the searchable metadata", () => {
    for (const asset of allAssets) {
      expect(asset.pack?.id, asset.id).toMatch(/^pak_/);
      expect(asset.pack?.version, asset.id).toMatch(/^\d+\.\d+\.\d+$/);
      expect(asset.name, asset.id).toBeTruthy();
      expect(asset.role, asset.id).toBeTruthy();
      expect(asset.tags.genres.length, asset.id).toBeGreaterThan(0);
      expect(asset.tags.characters.length, asset.id).toBeGreaterThan(0);
      expect(asset.tags.intensity, asset.id).toBeTruthy();
      expect(asset.license.id, asset.id).toBeTruthy();
      expect(asset.provenance.reviewState, asset.id).toBeTruthy();
    }
  });

  it("accepts the whole library it just built", () => {
    for (const packManifest of library.packManifests) {
      const { errors } = validatePackManifest(packManifest, {
        serialized: serialize(packManifest),
      });
      expect(errors, packManifest.pack.slug).toEqual([]);
    }
    expect(validateLibraryReferences(library.packManifests).errors).toEqual([]);
  });

  // Acceptance criterion 3: one pipeline for every type, including the pack
  // index — a loop or a preset must not need a second delivery path.
  it("produces pack records and a pack index covering every type", () => {
    const index = buildPackIndex(library.packManifests);
    expect(
      validatePackIndex(index, library.packManifests, {
        serialized: serialize(index),
      }).errors,
    ).toEqual([]);

    const drums = library.packManifests.find(
      (pm) => pm.pack.slug === "core-electronic-drums",
    );
    const types = new Set(drums.assets.map((asset) => asset.type));
    expect(types).toContain("loop");
    expect(types).toContain("preset");
    expect(drums.pack.assetCount).toBe(drums.assets.length);
  });
});

describe("loops (sample-library section 10)", () => {
  it("records verified BPM, bar count, time signature, and seam", () => {
    for (const asset of allAssets.filter((a) => a.type === "loop")) {
      expect(asset.audio.loopable, asset.id).toBe(true);
      expect(asset.audio.bpm, asset.id).toBeGreaterThan(0);
      expect(asset.audio.bars, asset.id).toBeGreaterThan(0);
      expect(asset.audio.timeSignature, asset.id).toBe("4/4");
      expect(asset.audio.grid.errorSamples, asset.id).toBe(0);
      expect(asset.audio.grid.sampleAligned, asset.id).toBe(true);
      expect(asset.audio.seam.cyclesVerified, asset.id).toBe(SEAM_CYCLES);
      expect(asset.audio.seam.seamless, asset.id).toBe(true);
    }
  });

  it("computes the bar length from the tempo, not from the buffer", () => {
    // 1 bar of 4/4 at 120 BPM is exactly 2 seconds — 96,000 frames at 48 kHz.
    expect(loopFrames({ bpm: 120, bars: 1, timeSignature: "4/4" })).toEqual({
      exact: 96_000,
      frames: 96_000,
      aligned: true,
    });
    // 6/8 is three quarter notes to the bar, not six.
    expect(loopFrames({ bpm: 120, bars: 1, timeSignature: "6/8" }).frames).toBe(72_000);
  });

  it("refuses to render a tempo that is not a whole number of samples", () => {
    expect(() =>
      renderLoop(
        {
          name: "Fractional",
          bpm: 140,
          bars: 1,
          timeSignature: "4/4",
          pattern: [],
        },
        () => new Float32Array(4),
      ),
    ).toThrow(/not a whole number of samples/);
  });

  it("hears a seam a click would produce", () => {
    // A ramp that never returns to where it started: continuous inside the
    // loop, a full-scale step at the wrap.
    const ramp = new Float32Array(4_800);
    for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length;
    const seam = analyzeSeam(ramp, { cycles: 4 });
    expect(seam.seamless).toBe(false);
    expect(seam.wrapStepDbfs).toBeGreaterThan(seam.interiorStepDbfs);
  });

  it("accepts a loop whose wrap is no worse than its own transients", () => {
    const square = new Float32Array(4_800);
    for (let i = 0; i < square.length; i++) square[i] = i < 2_400 ? 0.5 : -0.5;
    expect(analyzeSeam(square, { cycles: 4 }).seamless).toBe(true);
  });

  it("verifies a declared tempo against the buffer that exists", () => {
    const grid = verifyGrid(new Float32Array(90_000), {
      bpm: 120,
      bars: 1,
      timeSignature: "4/4",
    });
    expect(grid.errorSamples).toBe(-6_000);
  });

  it.each([
    [
      "a loop whose seam clicks",
      (m) => {
        loopIn(m).audio.seam.seamless = false;
      },
      /loop point clicks/,
    ],
    [
      "a loop tested over too few cycles",
      (m) => {
        loopIn(m).audio.seam.cyclesVerified = 4;
      },
      /below the 32 minimum/,
    ],
    [
      "a loop off its own bar grid",
      (m) => {
        loopIn(m).audio.grid.errorSamples = 512;
      },
      /samples off the .* BPM bar grid/,
    ],
    [
      "a loop whose length is not a whole number of samples",
      (m) => {
        loopIn(m).audio.grid.sampleAligned = false;
      },
      /not a whole number of samples/,
    ],
    [
      "a loop with no seam measurement at all",
      (m) => {
        loopIn(m).audio.seam = undefined;
      },
      /missing its seam measurement/,
    ],
    [
      "a loop that does not declare itself loopable",
      (m) => {
        loopIn(m).audio.loopable = false;
      },
      /must declare loopable: true/,
    ],
    [
      "a loop with an unknown time signature",
      (m) => {
        loopIn(m).audio.timeSignature = "5/16";
      },
      /unknown time signature/,
    ],
  ])("rejects %s", (_label, mutate, expected) => {
    expect(errorsFor(mutate).join("\n")).toMatch(expected);
  });

  function loopIn(manifest) {
    return manifest.assets.find((asset) => asset.type === "loop");
  }

  it("builds every catalogue loop", () => {
    expect(LOOP_CATALOG.length).toBeGreaterThan(0);
    expect(allAssets.filter((asset) => asset.type === "loop")).toHaveLength(
      LOOP_CATALOG.length,
    );
  });
});

describe("presets (sample-library sections 5, 10)", () => {
  it("delivers presets as content-addressed JSON with no audio", () => {
    const presets = allAssets.filter((asset) => asset.type === "preset");
    expect(presets).toHaveLength(PRESET_CATALOG.length);
    for (const preset of presets) {
      expect(preset.files.master.format, preset.id).toBe("json");
      expect(preset.files.master.storageKey, preset.id).toBe(
        storageKeyFor(preset.files.master.sha256, "json"),
      );
      expect(preset.audio, preset.id).toBeNull();
      expect(preset.waveform, preset.id).toBeNull();
    }
  });

  it("references assets by pack-qualified ID, never by path", () => {
    for (const preset of allAssets.filter((a) => a.type === "preset")) {
      const references = [
        ...(preset.preset.pads ?? []).map((pad) => pad.assetId),
        ...(preset.preset.zones ?? []).map((zone) => zone.assetId),
      ];
      for (const reference of references) {
        expect(reference, preset.id).toMatch(/^sg-/);
        expect(byId.get(reference)?.pack.id, reference).toBe(preset.pack.id);
      }
    }
  });

  it("covers a contiguous key range in every multisample instrument", () => {
    const instruments = allAssets.filter((asset) => asset.preset?.kind === "instrument");
    expect(instruments.length).toBeGreaterThan(0);
    for (const instrument of instruments) {
      const zones = [...instrument.preset.zones].sort((a, b) => a.lowNote - b.lowNote);
      for (let index = 1; index < zones.length; index++) {
        expect(zones[index].lowNote, instrument.id).toBe(zones[index - 1].highNote + 1);
      }
    }
  });

  it.each([
    [
      "a preset that claims audio it does not have",
      "core-electronic-drums",
      (m) => {
        presetIn(m).audio = { sampleRate: 48_000 };
      },
      /must not carry audio metadata/,
    ],
    [
      "a preset pad pointing at a file path",
      "core-electronic-drums",
      (m) => {
        presetIn(m).preset.pads[0].assetId = "samples/house/kick.wav";
      },
      /references a path, not an asset ID/,
    ],
    [
      "an instrument zone whose root is outside its own range",
      "tonal-elements",
      (m) => {
        m.assets.find((a) => a.preset?.kind === "instrument").preset.zones[0].rootNote =
          "C7";
      },
      /lies outside its own/,
    ],
    [
      "an instrument zone that leaves a gap in the keyboard",
      "tonal-elements",
      (m) => {
        m.assets.find((a) => a.preset?.kind === "instrument").preset.zones[1].lowNote +=
          3;
      },
      /leave a gap between/,
    ],
  ])("rejects %s", (_label, slug, mutate, expected) => {
    expect(errorsForPack(slug, mutate).join("\n")).toMatch(expected);
  });

  function presetIn(manifest) {
    return manifest.assets.find((asset) => asset.type === "preset");
  }

  it("rejects a preset pad that resolves to nothing", () => {
    const manifests = structuredClone(library.packManifests);
    const preset = manifests
      .flatMap((pm) => pm.assets)
      .find((asset) => asset.preset?.pads);
    preset.preset.pads[0].assetId = "sg-one-shot-drums-kick-9999";
    expect(validateLibraryReferences(manifests).errors.join("\n")).toMatch(
      /which the library does not deliver/,
    );
  });
});

describe("derived masters (sample-library section 10)", () => {
  it("records the source asset, transform, and untouched checksum", () => {
    const derived = allAssets.filter((asset) => asset.type === "derived");
    expect(derived).toHaveLength(DERIVED_CATALOG.length);
    for (const asset of derived) {
      const source = byId.get(asset.derivedFrom.assetId);
      expect(source, asset.id).toBeDefined();
      expect(asset.derivedFrom.sourceSha256).toBe(source.files.master.sha256);
      expect(asset.provenance.sourceType).toBe("processed");
      expect(asset.provenance.modifications).toContain(asset.derivedFrom.transform);
      expect(asset.tags.sourceTypes).toContain("processed");
    }
  });

  it("rejects a derived master whose source checksum does not match", () => {
    const manifests = structuredClone(library.packManifests);
    const derived = manifests
      .flatMap((pm) => pm.assets)
      .find((asset) => asset.type === "derived");
    derived.derivedFrom.sourceSha256 = "b".repeat(64);
    expect(validateLibraryReferences(manifests).errors.join("\n")).toMatch(
      /does not match .*master checksum/,
    );
  });

  it.each([
    [
      "a derived master with no source",
      (m) => {
        derivedIn(m).derivedFrom = undefined;
      },
      /missing derivedFrom/,
    ],
    [
      "an unknown transform",
      (m) => {
        derivedIn(m).derivedFrom.transform = "time-travel";
      },
      /unknown transform/,
    ],
    [
      "a transform the provenance does not record",
      (m) => {
        derivedIn(m).provenance.modifications = [];
      },
      /does not record the .* transform/,
    ],
  ])("rejects %s", (_label, mutate, expected) => {
    expect(errorsFor(mutate).join("\n")).toMatch(expected);
  });

  function derivedIn(manifest) {
    return manifest.assets.find((asset) => asset.type === "derived");
  }
});

describe("rights and broken paths (LIB-04, sample-library sections 3.4, 9)", () => {
  it.each([
    [
      "an asset requiring attribution its pack does not carry",
      (m) => {
        m.assets[0].license.attributionRequired = true;
      },
      /does not carry/,
    ],
    [
      "an asset whose licence evidence file is gone",
      (m) => {
        m.assets[0].license.evidencePath = "docs/licenses/not-a-file.md";
      },
      /does not exist/,
    ],
    [
      "an asset whose licence exceeds its pack's rights position",
      (m) => {
        m.assets[0].license.id = "CC0-1.0";
      },
      /exceeds pack .* rights position/,
    ],
    [
      "an asset that has not been approved for raw redistribution",
      (m) => {
        m.assets[0].license.rawRedistributionAllowed = false;
      },
      /raw redistribution is not approved/,
    ],
    [
      "a duplicate asset id inside one pack",
      (m) => {
        m.assets.push(structuredClone(m.assets[0]));
      },
      /duplicate asset id/,
    ],
  ])("rejects %s", (_label, mutate, expected) => {
    expect(errorsFor(mutate).join("\n")).toMatch(expected);
  });

  it("rejects the same asset id appearing in two packs", () => {
    const manifests = structuredClone(library.packManifests);
    manifests[1].assets.push(structuredClone(manifests[0].assets[0]));
    expect(validateLibraryReferences(manifests).errors.join("\n")).toMatch(
      /appears in more than one pack/,
    );
  });
});

describe("intake states and quarantine (sample-library section 11)", () => {
  it("ships nothing below metadata review", () => {
    expect(INTAKE_STATES).toHaveLength(9);
    for (const state of ["candidate", "rights-review", "quarantine", "removed"]) {
      expect(isDeliverable(state), state).toBe(false);
      expect(withheldReason(state), state).toBeTruthy();
    }
    for (const state of DELIVERABLE_STATES) {
      expect(withheldReason(state), state).toBeNull();
    }
  });

  it("treats an unknown state as withheld rather than as shippable", () => {
    expect(withheldReason("looks-fine")).toMatch(/unknown intake state/);
  });

  it("isolates quarantined and corrupt assets from the manifests", () => {
    const quarantined = structuredClone(assetOfType("one-shot"));
    quarantined.id = "sg-one-shot-drums-kick-9001";
    quarantined.provenance.reviewState = "quarantine";
    const corrupt = structuredClone(assetOfType("one-shot"));
    corrupt.id = "sg-one-shot-drums-kick-9002";

    const shippable = structuredClone(assetOfType("loop"));
    const { delivered, withheld } = partitionByIntake([
      { asset: quarantined, bytes: bytesFor(quarantined) },
      { asset: corrupt, bytes: Buffer.alloc(0) },
      { asset: shippable, bytes: bytesFor(shippable) },
    ]);

    expect(delivered.map(({ asset }) => asset.id)).toEqual([shippable.id]);
    expect(withheld.map((entry) => entry.id)).toEqual([
      "sg-one-shot-drums-kick-9001",
      "sg-one-shot-drums-kick-9002",
    ]);
    expect(withheld[1].reason).toMatch(/corrupt or failed render/);
    expect(formatWithheldReport(withheld)).toMatch(/2 asset\(s\) withheld/);
  });

  /** A buffer the declared master size agrees with, so only the state differs. */
  function bytesFor(asset) {
    return Buffer.alloc(asset.files.master.bytes, 1);
  }

  it("reports an empty quarantine rather than saying nothing", () => {
    expect(formatWithheldReport([])).toMatch(/nothing withheld/);
    expect(library.withheld).toEqual([]);
  });

  it("rejects an undeliverable intake state that reached a manifest anyway", () => {
    expect(
      errorsFor((m) => {
        m.assets[0].provenance.reviewState = "quarantine";
      }).join("\n"),
    ).toMatch(/is not deliverable but the asset is in a published manifest/);
  });
});

describe("determinism", () => {
  it("renders byte-identical loops, presets, and derived masters", () => {
    const renderSource = makeRenderSource();
    const loopEntry = LOOP_CATALOG[0];
    expect(buildLoop(loopEntry, renderSource).bytes).toEqual(
      buildLoop(loopEntry, makeRenderSource()).bytes,
    );
    expect(buildPreset(PRESET_CATALOG[0]).bytes).toEqual(
      buildPreset(PRESET_CATALOG[0]).bytes,
    );
    const hashes = new Map(
      allAssets.map((asset) => [asset.id, asset.files.master.sha256]),
    );
    const derivedEntry = DERIVED_CATALOG[0];
    expect(buildDerived(derivedEntry, renderSource, hashes).bytes).toEqual(
      buildDerived(derivedEntry, makeRenderSource(), hashes).bytes,
    );
  }, 60_000);

  /**
   * The real renderer, freshly seeded each call — the point is that two
   * independent renders agree, not that a cache hands back the same object.
   */
  function makeRenderSource() {
    const entries = new Map(CATALOG.map((entry) => [entry.id, entry]));
    return (id) => renderVoice(entries.get(id), createRng(seedFromString(id)));
  }
});

describe("the pack a preset or loop lands in", () => {
  it("keeps every asset in exactly one registered pack", () => {
    for (const packManifest of library.packManifests) {
      expect(packBySlug(packManifest.pack.slug)).not.toBeNull();
      for (const asset of packManifest.assets) {
        expect(asset.pack.id, asset.id).toBe(packManifest.pack.id);
      }
    }
  });
});
