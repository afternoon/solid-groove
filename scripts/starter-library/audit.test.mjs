import { describe, expect, it } from "vitest";
import {
  AUDITS,
  auditRelease,
  decodeWav,
  formatAuditReport,
  measureLevels,
  parseArgs,
} from "./audit.mjs";
import { buildAllPacks } from "./manifest.mjs";
import { encodeWav, sha256, storageKeyFor } from "./wav.mjs";

/** Built once: rendering the library is the expensive part of this suite. */
const built = buildAllPacks();

/** A deep copy of the built library, so each case perturbs its own. */
function library() {
  return {
    files: built.files.map((file) => ({ ...file })),
    packManifests: structuredClone(built.packManifests),
  };
}

function packOf(lib, slug) {
  const manifest = lib.packManifests.find((pm) => pm.pack.slug === slug);
  if (!manifest) throw new Error(`no pack ${slug}`);
  return manifest;
}

function assetOf(lib, predicate) {
  for (const manifest of lib.packManifests) {
    const asset = manifest.assets.find(predicate);
    if (asset) return { asset, manifest };
  }
  throw new Error("no asset matches");
}

/**
 * Ship `bytes` as `asset`'s master, with a record that honestly names them
 * (checksum, key, size), so the only thing wrong is what the case is about.
 */
function replaceBytes(lib, asset, bytes) {
  const oldKey = asset.files.master.storageKey;
  const hash = sha256(bytes);
  const key = storageKeyFor(hash, asset.files.master.format);
  asset.files.master = {
    ...asset.files.master,
    sha256: hash,
    storageKey: key,
    bytes: bytes.length,
  };
  lib.files = lib.files.filter((file) => file.storageKey !== oldKey);
  lib.files.push({ storageKey: key, bytes });
}

function bytesOf(lib, asset) {
  return lib.files.find((file) => file.storageKey === asset.files.master.storageKey)
    .bytes;
}

const audit = (lib) => auditRelease(lib, { pathExists: () => true });

function findings(result, auditName, severity = "error") {
  return result.findings.filter(
    (finding) => finding.audit === auditName && finding.severity === severity,
  );
}

const firstOneShot = (lib) =>
  assetOf(lib, (asset) => asset.type === "one-shot" && asset.family === "drums");
const firstLoop = (lib) => assetOf(lib, (asset) => asset.type === "loop");

describe("decodeWav", () => {
  it("decodes what the build encodes, sample for sample within 24-bit precision", () => {
    const left = Float32Array.from({ length: 480 }, (_, i) => Math.sin(i / 10) * 0.5);
    const right = Float32Array.from(left, (value) => -value);
    const decoded = decodeWav(encodeWav([left, right], 44_100));
    expect(decoded).toMatchObject({
      channels: 2,
      sampleRate: 44_100,
      bitDepth: 24,
      frames: 480,
    });
    for (let i = 0; i < 480; i++) {
      expect(decoded.samples[0][i]).toBeCloseTo(left[i], 6);
      expect(decoded.samples[1][i]).toBeCloseTo(right[i], 6);
    }
  });

  it("walks past chunks it does not know, padded to a word", () => {
    const plain = encodeWav(new Float32Array([0.25, -0.25]));
    // RIFF header, then an odd-sized LIST chunk and its pad byte, then the rest.
    const extra = Buffer.concat([
      Buffer.from("LIST"),
      Buffer.from([3, 0, 0, 0]),
      Buffer.from("abc"),
      Buffer.from([0]),
    ]);
    const bytes = Buffer.concat([plain.subarray(0, 12), extra, plain.subarray(12)]);
    expect(decodeWav(bytes).samples[0][0]).toBeCloseTo(0.25, 6);
  });

  it("refuses anything a browser would not decode as the record says", () => {
    const good = encodeWav(new Float32Array(4));
    expect(() => decodeWav(Buffer.from("nope"))).toThrow(/too short/);
    expect(() =>
      decodeWav(Buffer.concat([Buffer.from("RIFX"), good.subarray(4)])),
    ).toThrow(/RIFF/);
    const float = Buffer.from(good);
    float.writeUInt16LE(3, 20);
    expect(() => decodeWav(float)).toThrow(/not PCM/);
    expect(() => decodeWav(good.subarray(0, good.length - 2))).toThrow(/past the end/);
  });
});

describe("measureLevels", () => {
  it("takes peak and RMS across every channel", () => {
    const levels = measureLevels([
      new Float32Array([0.5, -0.5]),
      new Float32Array([0, 0]),
    ]);
    expect(levels.peakDbfs).toBeCloseTo(-6.02, 2);
    expect(levels.rmsDbfs).toBeCloseTo(-9.03, 2);
  });
});

describe("auditRelease against the library this build produces", () => {
  const result = audit(library());

  it("passes every shipped pack with no errors", () => {
    expect(result.findings.filter((finding) => finding.severity === "error")).toEqual([]);
    expect(result.errors).toBe(0);
    expect(result.packs.map((pack) => pack.slug)).toEqual(
      built.packManifests.map((pm) => pm.pack.slug),
    );
    for (const pack of result.packs) expect(pack.errors, pack.slug).toBe(0);
  });

  it("reports each pack's rights position and coverage claim", () => {
    const drums = result.packs.find((pack) => pack.slug === "core-electronic-drums");
    expect(drums.rights).toEqual({
      licence: "solid-groove-owned",
      rawRedistribution: true,
      attributionRequired: false,
    });
    expect(drums.coverage.roles).toContain("kick");
    expect(drums.coverage.unclaimedRoles).toEqual(expect.any(Array));
    expect(drums.assets).toBe(packOf(built, "core-electronic-drums").assets.length);
  });

  it("reports every audit section, even an empty one", () => {
    const report = formatAuditReport(result);
    for (const name of AUDITS) expect(report).toContain(`${name}: `);
    expect(report).toContain("pass  core-electronic-drums");
  });
});

describe("the pack audit: coverage claim and rights position", () => {
  it("fails a pack that claims a role it does not deliver", () => {
    const lib = library();
    const drums = packOf(lib, "core-electronic-drums");
    drums.pack.coverage.roles.push("reese");
    const result = audit(lib);
    expect(findings(result, "pack").map((finding) => finding.message)).toContainEqual(
      expect.stringContaining('claims role "reese"'),
    );
    expect(
      result.packs.find((pack) => pack.slug === "core-electronic-drums").errors,
    ).toBe(1);
  });

  it("fails an asset whose licence exceeds its pack's rights position", () => {
    const lib = library();
    const { asset } = firstOneShot(lib);
    asset.license.id = "CC0-1.0";
    expect(findings(audit(lib), "pack").map((finding) => finding.message)).toContainEqual(
      expect.stringContaining("exceeds pack"),
    );
  });

  it("fails a pack that does not say what it leaves out", () => {
    const lib = library();
    packOf(lib, "foundation-bass").pack.description = "Bass one-shots.";
    expect(findings(audit(lib), "pack")).toContainEqual(
      expect.objectContaining({
        pack: "foundation-bass",
        message: "description does not state what the pack does not contain",
      }),
    );
  });

  it("flags a pack with no coverage claim for review", () => {
    const lib = library();
    packOf(lib, "ambient-textures").pack.coverage = null;
    expect(findings(audit(lib), "pack", "warning")).toContainEqual(
      expect.objectContaining({ pack: "ambient-textures" }),
    );
  });
});

describe("the missing-file audit", () => {
  it("fails an entry whose file was not delivered", () => {
    const lib = library();
    const { asset } = firstOneShot(lib);
    lib.files = lib.files.filter(
      (file) => file.storageKey !== asset.files.master.storageKey,
    );
    expect(findings(audit(lib), "missing-file")).toContainEqual(
      expect.objectContaining({ assetId: asset.id }),
    );
  });

  it("fails a delivered file no entry names", () => {
    const lib = library();
    lib.files.push({ storageKey: "sha256/00/00/orphan.wav", bytes: Buffer.alloc(8) });
    expect(findings(audit(lib), "missing-file")).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("orphan.wav") }),
    );
  });

  it("fails a file whose size disagrees with its record", () => {
    const lib = library();
    const { asset } = firstOneShot(lib);
    asset.files.master.bytes += 1;
    expect(findings(audit(lib), "missing-file")).toContainEqual(
      expect.objectContaining({ assetId: asset.id }),
    );
  });
});

describe("the decode audit", () => {
  it("fails bytes that do not match the recorded checksum", () => {
    const lib = library();
    const { asset } = firstOneShot(lib);
    const bytes = Buffer.from(bytesOf(lib, asset));
    bytes[bytes.length - 1] ^= 0xff;
    lib.files.find((file) => file.storageKey === asset.files.master.storageKey).bytes =
      bytes;
    expect(findings(audit(lib), "decode")).toContainEqual(
      expect.objectContaining({
        assetId: asset.id,
        message: expect.stringContaining("SHA-256"),
      }),
    );
  });

  it("fails a master that does not decode", () => {
    const lib = library();
    const { asset } = firstOneShot(lib);
    const bytes = Buffer.from(bytesOf(lib, asset));
    bytes.write("JUNK", 8, "ascii");
    replaceBytes(lib, asset, bytes);
    expect(findings(audit(lib), "decode")).toContainEqual(
      expect.objectContaining({
        assetId: asset.id,
        message: "does not decode: not a WAVE file",
      }),
    );
  });

  it("fails a master whose rate, channels or length disagree with its record", () => {
    const lib = library();
    const { asset } = firstOneShot(lib);
    const { samples } = decodeWav(bytesOf(lib, asset));
    replaceBytes(lib, asset, encodeWav([samples[0], samples[0].subarray()], 44_100));
    const messages = findings(audit(lib), "decode")
      .filter((finding) => finding.assetId === asset.id)
      .map((finding) => finding.message);
    expect(messages).toEqual([
      expect.stringContaining("sample rate 44100"),
      expect.stringContaining("channels 2"),
      expect.stringContaining("duration"),
    ]);
  });

  it("fails a preset that does not parse", () => {
    const lib = library();
    const { asset } = assetOf(lib, (candidate) => candidate.type === "preset");
    replaceBytes(lib, asset, Buffer.from("{not json"));
    expect(findings(audit(lib), "decode")).toContainEqual(
      expect.objectContaining({ assetId: asset.id }),
    );
  });
});

describe("the loudness audit", () => {
  function withSamples(transform) {
    const lib = library();
    const { asset } = firstOneShot(lib);
    const { samples } = decodeWav(bytesOf(lib, asset));
    replaceBytes(lib, asset, encodeWav(transform(samples[0])));
    return { lib, asset };
  }

  it("fails a master whose peak is not the one its record states", () => {
    const { lib, asset } = withSamples((samples) => samples.map((value) => value * 0.5));
    expect(findings(audit(lib), "loudness")).toContainEqual(
      expect.objectContaining({
        assetId: asset.id,
        message: expect.stringContaining("the record says"),
      }),
    );
  });

  it("fails a master that leaves no headroom", () => {
    const { lib, asset } = withSamples((samples) => {
      const peak = Math.max(...samples.map(Math.abs));
      return samples.map((value) => value / peak);
    });
    asset.audio.peakDbfs = 0;
    expect(findings(audit(lib), "loudness")).toContainEqual(
      expect.objectContaining({
        assetId: asset.id,
        message: expect.stringContaining("ceiling"),
      }),
    );
  });

  it("fails a silent master", () => {
    const { lib, asset } = withSamples((samples) => new Float32Array(samples.length));
    expect(findings(audit(lib), "loudness")).toContainEqual(
      expect.objectContaining({ assetId: asset.id, message: "is silent" }),
    );
  });

  it("flags audio too quiet to audition and audio with its dynamics flattened", () => {
    const quiet = withSamples((samples) => {
      const out = new Float32Array(samples.length);
      out[0] = 0.8; // one loud click, then near silence
      for (let i = 1; i < out.length; i++) out[i] = i % 2 ? 1e-4 : -1e-4;
      return out;
    });
    quiet.asset.audio.peakDbfs = Number((20 * Math.log10(0.8)).toFixed(2));
    expect(findings(audit(quiet.lib), "loudness", "warning")).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("too quiet") }),
    );

    const square = withSamples((samples) => samples.map((_, i) => (i % 2 ? 0.8 : -0.8)));
    square.asset.audio.peakDbfs = Number((20 * Math.log10(0.8)).toFixed(2));
    expect(findings(audit(square.lib), "loudness", "warning")).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("brick-wall") }),
    );
  });
});

describe("the tuning audit", () => {
  const pitched = (lib) =>
    assetOf(lib, (asset) => asset.type === "one-shot" && asset.family === "bass");

  it("fails a pitched one-shot with no root note", () => {
    const lib = library();
    const { asset } = pitched(lib);
    asset.audio.rootNote = null;
    asset.audio.tuningCents = null;
    expect(findings(audit(lib), "tuning")).toContainEqual(
      expect.objectContaining({
        assetId: asset.id,
        message: "pitched one-shot has no root note",
      }),
    );
  });

  it("fails a root further than a quarter-tone out", () => {
    const lib = library();
    const { asset } = pitched(lib);
    asset.audio.tuningStatus = "detected";
    asset.audio.tuningCents = 70;
    expect(findings(audit(lib), "tuning")).toContainEqual(
      expect.objectContaining({ assetId: asset.id }),
    );
  });

  it("fails a measured root with no tuning reading", () => {
    const lib = library();
    const { asset } = pitched(lib);
    asset.audio.tuningStatus = "detected";
    asset.audio.tuningCents = null;
    expect(findings(audit(lib), "tuning")).toContainEqual(
      expect.objectContaining({
        assetId: asset.id,
        message: `root ${asset.audio.rootNote} has no tuning reading`,
      }),
    );
  });

  it.each(["undetectable", "gliding"])(
    "warns, not fails, on a root the detector found %s",
    (status) => {
      const lib = library();
      const { asset } = pitched(lib);
      asset.audio.tuningStatus = status;
      asset.audio.tuningCents = null;
      const result = audit(lib);
      expect(findings(result, "tuning")).not.toContainEqual(
        expect.objectContaining({ assetId: asset.id }),
      );
      expect(findings(result, "tuning", "warning")).toContainEqual(
        expect.objectContaining({
          assetId: asset.id,
          message: `root ${asset.audio.rootNote} could not be measured (${status}); review it by ear`,
        }),
      );
    },
  );

  it("does not tune a loop against its key", () => {
    const lib = library();
    const { asset } = assetOf(
      lib,
      (candidate) => candidate.type === "loop" && candidate.audio.rootNote,
    );
    asset.audio.tuningCents = null;
    expect(findings(audit(lib), "tuning")).not.toContainEqual(
      expect.objectContaining({ assetId: asset.id }),
    );
  });

  it("finds no tuning error in the library as built", () => {
    expect(findings(audit(library()), "tuning")).toEqual([]);
  });
});

describe("the loop-boundary audit", () => {
  it("fails a loop that is off its bar grid", () => {
    const lib = library();
    const { asset } = firstLoop(lib);
    const { samples } = decodeWav(bytesOf(lib, asset));
    const longer = new Float32Array(samples[0].length + 10);
    longer.set(samples[0]);
    replaceBytes(lib, asset, encodeWav(longer));
    asset.audio.durationSeconds = Number((longer.length / 48_000).toFixed(4));
    expect(findings(audit(lib), "loop-boundary")).toContainEqual(
      expect.objectContaining({
        assetId: asset.id,
        message: expect.stringContaining("10 samples off"),
      }),
    );
  });

  it("fails a loop that clicks where it wraps", () => {
    const lib = library();
    const { asset } = firstLoop(lib);
    const { samples } = decodeWav(bytesOf(lib, asset));
    // A smooth ramp from silence to a loud level: no step inside it, a big one at the wrap.
    const ramp = samples[0].map((_, i) => (i / samples[0].length) * 0.8);
    replaceBytes(lib, asset, encodeWav(ramp));
    asset.audio.peakDbfs = Number(measureLevels([ramp]).peakDbfs.toFixed(2));
    expect(findings(audit(lib), "loop-boundary")).toContainEqual(
      expect.objectContaining({
        assetId: asset.id,
        message: expect.stringContaining("clicks"),
      }),
    );
  });
});

describe("the duplicates audit", () => {
  it("fails the same master in two packs", () => {
    const lib = library();
    const { asset } = firstOneShot(lib);
    const bass = packOf(lib, "foundation-bass");
    bass.assets[0].files.master = { ...asset.files.master };
    expect(findings(audit(lib), "duplicates")).toContainEqual(
      expect.objectContaining({
        pack: "foundation-bass",
        message: expect.stringContaining(`byte-identical to ${asset.id}`),
      }),
    );
  });

  it("flags two different masters with the same length and overview for a listen", () => {
    const lib = library();
    const drums = packOf(lib, "core-electronic-drums").assets;
    const [first, second] = drums.filter((asset) => asset.type === "one-shot");
    second.peaks = [...first.peaks];
    second.audio.durationSeconds = first.audio.durationSeconds;
    expect(findings(audit(lib), "duplicates", "warning")).toContainEqual(
      expect.objectContaining({
        assetId: second.id,
        message: expect.stringContaining(first.id),
      }),
    );
  });
});

describe("parseArgs", () => {
  it("takes --json and refuses anything else", () => {
    expect(parseArgs(["--json"])).toEqual({ json: true });
    expect(() => parseArgs(["--nope"])).toThrow(/unknown flag/);
  });
});
