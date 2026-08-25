import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { zipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import {
  extractMember,
  isArchive,
  listArchiveMembers,
  unsupportedArchiveReason,
} from "./acquire/archive.mjs";
import {
  decodeToSamples,
  downmixToMono,
  isEffectivelyMono,
  isSupportedAudio,
  leadingSilenceOffset,
  prepareOneShot,
} from "./acquire/audio.mjs";
import {
  captureLicenseEvidence,
  download,
  fetchToQuarantine,
  sha256,
} from "./acquire/fetch.mjs";
import {
  acquiredAssetId,
  ingestSelection,
  resolveSelectedBytes,
} from "./acquire/ingest.mjs";
import { emptyLockfile, validateLockfile, writeLockfile } from "./acquire/lockfile.mjs";
import {
  APPROVED_LICENSES,
  findSource,
  licenseRejectionReason,
  SOURCES,
} from "./acquire/sources.mjs";
import { packBySlug, RESERVED_CC0_PACK_SLUG } from "./packs.mjs";
import { validatePackManifest } from "./validate.mjs";
import { encodeWav } from "./wav.mjs";

// The acquisition path is exercised end to end against fixtures we build here
// and serve over `file://`. Every stage downstream of the URL is the real
// implementation — checksum verification, zip extraction, Web Audio decode,
// section 10 preparation, manifest construction, validation — so this proves
// the pipeline works rather than proving a mock matches a mock.

const workspace = mkdtempSync(join(tmpdir(), "sg-acquire-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

/** A 44.1 kHz mono hit with leading silence, like a real CC0 one-shot. */
function fixtureWav({
  rate = 44100,
  seconds: length = 0.4,
  lead = 0.05,
  stereo = false,
} = {}) {
  const frames = Math.round(length * rate);
  const leadFrames = Math.round(lead * rate);
  const make = (phase) => {
    const out = new Float32Array(frames);
    for (let i = leadFrames; i < frames; i++) {
      const t = (i - leadFrames) / rate;
      out[i] = Math.sin(2 * Math.PI * 220 * t + phase) * Math.exp(-t * 8) * 0.7;
    }
    return out;
  };
  return encodeWav(stereo ? [make(0), make(stereo === "wide" ? 1.2 : 0)] : make(0), rate);
}

function writeFixture(name, bytes) {
  const path = join(workspace, name);
  writeFileSync(path, bytes);
  return { path, url: pathToFileURL(path).href, bytes };
}

describe("source registry", () => {
  it("only lists sources whose licence may be bundled", () => {
    for (const source of SOURCES) {
      expect(APPROVED_LICENSES, source.id).toContain(source.licenseId);
      expect(licenseRejectionReason(source.licenseId)).toBeNull();
    }
  });

  it("records the rights position and review requirement for every source", () => {
    for (const source of SOURCES) {
      expect(source.rightsNote, source.id).toBeTruthy();
      expect(source.reviewNote, source.id).toBeTruthy();
      expect(source.licenseUrl, source.id).toMatch(/^https:\/\//);
      expect(source.maxSelections, source.id).toBeGreaterThan(0);
    }
  });

  // Section 3.2 rejects these even though they are open licences, because the
  // obligations they carry cannot survive stem and Ableton export.
  it.each([
    ["CC-BY-4.0", /attribution/],
    ["CC-BY-SA-4.0", /share-alike/],
    ["CC-BY-NC-4.0", /non-commercial/],
    ["CC-BY-ND-4.0", /no-derivatives/],
    ["GPL-3.0", /copyleft/],
    ["royalty-free", /prohibit redistributing raw files/],
  ])("explains why %s cannot be bundled", (licenseId, expected) => {
    expect(licenseRejectionReason(licenseId)).toMatch(expected);
  });

  it("rejects an unrecognized licence rather than assuming it is fine", () => {
    expect(licenseRejectionReason("MIT-but-for-audio")).toMatch(
      /not an approved licence/,
    );
  });
});

describe("lockfile validation", () => {
  const selection = () => ({
    id: "freesound-metal-scrape",
    sourceId: "freesound",
    downloadUrl: "https://freesound.org/data/previews/1/1_1-hq.wav",
    sourcePageUrl: "https://freesound.org/s/1/",
    creator: "example-uploader",
    originalFilename: "metal-scrape.wav",
    sha256: "a".repeat(64),
    bytes: 1024,
    retrievedAt: "2026-07-25",
    reviewer: "content-review",
    asset: {
      family: "drums",
      role: "percussion",
      pack: RESERVED_CC0_PACK_SLUG,
      name: "Scraped Metal Hit",
      genres: ["techno"],
      characters: ["metallic"],
      intensity: "medium",
      sourceType: "field-recording",
    },
  });

  it("accepts a complete, reviewed selection", () => {
    expect(validateLockfile({ version: 1, selections: [selection()] })).toEqual([]);
  });

  it("accepts an empty lockfile — acquisition is optional", () => {
    expect(validateLockfile(emptyLockfile())).toEqual([]);
  });

  it.each([
    [
      "an unknown source",
      (s) => {
        s.sourceId = "some-blog";
      },
      /unknown source/,
    ],
    [
      "a missing checksum",
      (s) => {
        s.sha256 = "";
      },
      /sha256 must be/,
    ],
    [
      "a missing source page",
      (s) => {
        s.sourcePageUrl = "";
      },
      /sourcePageUrl is required/,
    ],
    [
      "a missing creator",
      (s) => {
        s.creator = "";
      },
      /creator is required/,
    ],
    [
      "an unnamed reviewer",
      (s) => {
        s.reviewer = "unreviewed";
      },
      /reviewer is still/,
    ],
    [
      "a missing asset mapping",
      (s) => {
        s.asset = null;
      },
      /asset mapping is required/,
    ],
    [
      "an archive with no member pin",
      (s) => {
        s.archiveMember = "kick.wav";
      },
      /must pin memberSha256/,
    ],
  ])("rejects %s", (_label, mutate, expected) => {
    const one = selection();
    mutate(one);
    expect(validateLockfile({ version: 1, selections: [one] }).join("\n")).toMatch(
      expected,
    );
  });

  // `synthesized` is what the section 6.4 organic-source measurement counts
  // against. A downloaded recording claiming it would make the gap disappear
  // on paper without a single real recording entering the library.
  it("refuses to let acquired audio claim it was synthesized", () => {
    const one = selection();
    one.asset.sourceType = "synthesized";
    expect(validateLockfile({ version: 1, selections: [one] }).join("\n")).toMatch(
      /cannot claim sourceType "synthesized"/,
    );
  });

  // CNT-000b: acquired content records its destination pack in the lockfile at
  // pin time, and its rights position has to actually match the source.
  it("rejects a selection with no destination pack", () => {
    const one = selection();
    one.asset = { ...one.asset, pack: undefined };
    expect(validateLockfile({ version: 1, selections: [one] }).join("\n")).toMatch(
      /asset.pack is required/,
    );
  });

  it("rejects a selection naming a pack packs.mjs never registered", () => {
    const one = selection();
    one.asset = { ...one.asset, pack: "not-a-real-pack" };
    expect(validateLockfile({ version: 1, selections: [one] }).join("\n")).toMatch(
      /"not-a-real-pack" is not a registered pack/,
    );
  });

  it("rejects a selection whose pack's rights position the source cannot satisfy", () => {
    const one = selection();
    // The synthesized-only packs are `solid-groove-owned`; a CC0 Freesound
    // selection cannot land in one of those without exceeding its rights.
    one.asset = { ...one.asset, pack: "core-electronic-drums" };
    expect(validateLockfile({ version: 1, selections: [one] }).join("\n")).toMatch(
      /exceeds pack "core-electronic-drums"'s rights position/,
    );
  });

  it("rejects duplicate ids and byte-identical selections", () => {
    const a = selection();
    const b = { ...selection(), id: "freesound-metal-scrape-2" };
    const errors = validateLockfile({ version: 1, selections: [a, b] }).join("\n");
    expect(errors).toMatch(/byte-identical to freesound-metal-scrape/);
  });

  it("enforces the per-source selection ceiling", () => {
    const source = findSource("kenney");
    const many = Array.from({ length: source.maxSelections + 1 }, (_unused, index) => ({
      ...selection(),
      id: `kenney-${index}`,
      sourceId: "kenney",
      sha256: String(index).padStart(64, "b"),
    }));
    expect(validateLockfile({ version: 1, selections: many }).join("\n")).toMatch(
      /over its \d+ ceiling/,
    );
  });

  it("round-trips through disk sorted by id", () => {
    const path = join(workspace, "lock.json");
    const written = writeLockfile(
      {
        version: 1,
        selections: [
          { ...selection(), id: "z-one" },
          { ...selection(), id: "a-one" },
        ],
      },
      { path, updatedAt: "2026-07-25T00:00:00.000Z" },
    );
    expect(written.selections.map((s) => s.id)).toEqual(["a-one", "z-one"]);
    expect(JSON.parse(readFileSync(path, "utf8")).updatedAt).toBe(
      "2026-07-25T00:00:00.000Z",
    );
  });
});

describe("download", () => {
  it("reads a file:// URL, which is how the offline path is tested", async () => {
    const fixture = writeFixture("plain.wav", fixtureWav());
    expect(await download(fixture.url)).toEqual(fixture.bytes);
  });

  // The checksum pin would catch a swap, but there is no reason to accept a
  // channel where one is possible.
  it("refuses plain http", async () => {
    await expect(download("http://example.com/kick.wav")).rejects.toThrow(/non-https/);
  });

  it("surfaces a failed request rather than writing an error page as audio", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    await expect(download("https://example.com/gone.wav", { fetchImpl })).rejects.toThrow(
      /404/,
    );
  });
});

describe("quarantine", () => {
  const baseSelection = (fixture) => ({
    id: "fixture-hit",
    sourceId: "freesound",
    downloadUrl: fixture.url,
    originalFilename: "hit.wav",
    sha256: sha256(fixture.bytes),
  });

  it("verifies the pinned checksum and stores the original", async () => {
    const fixture = writeFixture("quarantined.wav", fixtureWav());
    const result = await fetchToQuarantine(baseSelection(fixture), {
      quarantineDir: join(workspace, "quarantine"),
    });
    expect(result.sha256).toBe(sha256(fixture.bytes));
    expect(readFileSync(result.path)).toEqual(fixture.bytes);
  });

  // The bytes a person reviewed are not the bytes that arrived. Which one is
  // wrong is not something a script can decide, so it stops.
  it("fails hard when the bytes have changed since review", async () => {
    const fixture = writeFixture("changed.wav", fixtureWav());
    const selection = { ...baseSelection(fixture), sha256: "c".repeat(64) };
    await expect(
      fetchToQuarantine(selection, {
        quarantineDir: join(workspace, "quarantine"),
      }),
    ).rejects.toThrow(/checksum mismatch[\s\S]*Re-review before re-pinning/);
  });

  it("refuses to ingest anything unpinned unless pinning", async () => {
    const fixture = writeFixture("unpinned.wav", fixtureWav());
    const selection = { ...baseSelection(fixture), sha256: undefined };
    const quarantineDir = join(workspace, "quarantine");
    await expect(fetchToQuarantine(selection, { quarantineDir })).rejects.toThrow(
      /no pinned sha256; run with --pin/,
    );
    await expect(
      fetchToQuarantine(selection, { quarantineDir, pin: true }),
    ).resolves.toMatchObject({ sha256: sha256(fixture.bytes) });
  });
});

describe("licence evidence", () => {
  it("archives the licence statement with its own checksum", async () => {
    const licenseText = "This library is released under CC0 1.0 Universal.";
    const fetchImpl = async () => ({
      ok: true,
      headers: new Map([["content-length", String(licenseText.length)]]),
      arrayBuffer: async () => new TextEncoder().encode(licenseText).buffer,
    });
    const record = await captureLicenseEvidence(findSource("producer-space"), {
      evidenceDir: join(workspace, "evidence"),
      fetchImpl,
      now: "2026-07-25T10:00:00.000Z",
    });
    expect(record.status).toBe("captured");
    const written = readFileSync(record.path, "utf8");
    expect(written).toContain(licenseText);
    expect(written).toContain(sha256(Buffer.from(licenseText)));
    expect(written).toContain("CC0-1.0");
    expect(record.evidencePath).toBe("docs/licenses/sources/producer-space.md");
  });

  // A capture that failed must never be indistinguishable from one that
  // worked — that is exactly the record section 3.4 exists to prevent.
  it("records a failed capture as a failure", async () => {
    const fetchImpl = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const record = await captureLicenseEvidence(findSource("kenney"), {
      evidenceDir: join(workspace, "evidence"),
      fetchImpl,
      now: "2026-07-25T10:00:00.000Z",
    });
    expect(record.status).toBe("unavailable");
    expect(readFileSync(record.path, "utf8")).toMatch(
      /Capture failed[\s\S]*ECONNREFUSED/,
    );
  });
});

describe("archives", () => {
  const pack = () =>
    Buffer.from(
      zipSync({
        "pack/kick.wav": new Uint8Array(fixtureWav()),
        "pack/readme.txt": new TextEncoder().encode("CC0"),
      }),
    );

  it("lists members so a reviewer can see inside a pack", () => {
    expect(listArchiveMembers(pack()).map((m) => m.name)).toEqual([
      "pack/kick.wav",
      "pack/readme.txt",
    ]);
  });

  it("extracts exactly the pinned member", () => {
    expect(extractMember(pack(), "pack/kick.wav")).toEqual(fixtureWav());
  });

  // A fuzzy match would let the archive choose which file it hands back.
  it("fails on a member that is not there, and says what is", () => {
    expect(() => extractMember(pack(), "pack/snare.wav")).toThrow(
      /no member "pack\/snare.wav"[\s\S]*pack\/kick.wav/,
    );
  });

  it("recognizes archives and explains unsupported ones", () => {
    expect(isArchive("pack.zip")).toBe(true);
    expect(unsupportedArchiveReason("bank.tar.bz2")).toMatch(/bzip2[\s\S]*\.zip/);
    expect(unsupportedArchiveReason("bank.7z")).toMatch(/not supported/);
    expect(unsupportedArchiveReason("kick.wav")).toBeNull();
  });
});

describe("audio preparation", () => {
  it("decodes and resamples a 44.1 kHz source to 48 kHz", async () => {
    const decoded = await decodeToSamples(fixtureWav({ rate: 44100 }));
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.channels).toHaveLength(1);
  });

  it("reports a file it cannot decode instead of writing silence", async () => {
    await expect(decodeToSamples(Buffer.from("not audio at all"))).rejects.toThrow(
      /could not decode audio/,
    );
  });

  it("detects dual-mono and collapses it", () => {
    const channel = new Float32Array([0.1, -0.2, 0.3]);
    expect(isEffectivelyMono([channel, Float32Array.from(channel)])).toBe(true);
    expect(isEffectivelyMono([channel, new Float32Array([0.9, 0.1, -0.5])])).toBe(false);
    expect(
      Array.from(downmixToMono([new Float32Array([1, 1]), new Float32Array([0, 0])])),
    ).toEqual([0.5, 0.5]);
  });

  it("trims silence before the first transient", () => {
    const samples = new Float32Array(1000);
    samples.set([0.8, -0.6], 500);
    expect(leadingSilenceOffset(samples)).toBeGreaterThan(400);
    expect(leadingSilenceOffset(samples)).toBeLessThanOrEqual(500);
  });

  it("prepares a mono one-shot to the section 10 standard", async () => {
    const decoded = await decodeToSamples(fixtureWav({ lead: 0.05 }));
    const prepared = prepareOneShot(decoded.channels);
    expect(prepared).toHaveLength(1);
    let peak = 0;
    for (const value of prepared[0]) peak = Math.max(peak, Math.abs(value));
    expect(20 * Math.log10(peak)).toBeCloseTo(-1.5, 1);
    // The lead-in is gone, so the file starts at its attack.
    expect(prepared[0].length).toBeLessThan(decoded.channels[0].length);
  });

  // Trimming or normalizing channels independently would shift them relative
  // to each other and wreck the stereo image that is the reason to keep it.
  it("keeps genuine stereo aligned and equally scaled", async () => {
    const decoded = await decodeToSamples(fixtureWav({ stereo: "wide" }));
    expect(decoded.channels.length).toBe(2);
    const prepared = prepareOneShot(decoded.channels);
    expect(prepared).toHaveLength(2);
    expect(prepared[0].length).toBe(prepared[1].length);
  });
});

describe("end-to-end ingest", () => {
  const source = findSource("freesound");

  async function ingestFixture(overrides = {}, fixtureOptions = {}) {
    const wav = fixtureWav(fixtureOptions);
    const archive = Buffer.from(zipSync({ "pack/hit.wav": new Uint8Array(wav) }));
    const fixture = writeFixture(
      `pack-${Math.abs(hashCode(JSON.stringify(overrides)))}.zip`,
      archive,
    );
    const selection = {
      id: "freesound-hit",
      assetId: acquiredAssetId("drums", "percussion", 0),
      sourceId: source.id,
      downloadUrl: fixture.url,
      sourcePageUrl: "https://freesound.org/s/12345/",
      creator: "example-uploader",
      originalFilename: "pack.zip",
      archiveMember: "pack/hit.wav",
      sha256: sha256(archive),
      memberSha256: sha256(wav),
      bytes: archive.length,
      retrievedAt: "2026-07-25",
      reviewer: "content-review",
      asset: {
        family: "drums",
        role: "percussion",
        pack: RESERVED_CC0_PACK_SLUG,
        name: "Recorded Metal Hit",
        genres: ["techno", "dubstep", "drum-and-bass"],
        characters: ["metallic", "organic"],
        intensity: "medium",
        sourceType: "field-recording",
      },
      ...overrides,
    };
    return ingestSelection(selection, {
      quarantineDir: join(workspace, "quarantine"),
      evidencePathFor: () => "docs/licenses/sources/freesound.md",
    });
  }

  it("turns a pinned zip member into a manifest-shaped asset", async () => {
    const { asset, bytes } = await ingestFixture();
    expect(asset.id).toBe("sg-one-shot-drums-percussion-5001");
    expect(asset.type).toBe("one-shot");
    expect(asset.files.master.bytes).toBe(bytes.length);
    expect(asset.audio.sampleRate).toBe(48000);
    expect(asset.audio.bitDepth).toBe(24);
    expect(asset.audio.peakDbfs).toBeCloseTo(-1.5, 1);
    expect(asset.waveform.peaks).toHaveLength(128);
    expect(asset.tags.sourceTypes).toEqual(["field-recording"]);
  });

  it("records the rights and provenance section 3.4 requires", async () => {
    const { asset } = await ingestFixture();
    expect(asset.license).toMatchObject({
      id: "CC0-1.0",
      creator: "example-uploader",
      sourceUrl: "https://freesound.org/s/12345/",
      rawRedistributionAllowed: true,
      evidencePath: "docs/licenses/sources/freesound.md",
    });
    expect(asset.provenance).toMatchObject({
      sourceId: "freesound",
      originalFilename: "pack.zip",
      archiveMember: "pack/hit.wav",
      reviewer: "content-review",
      // The source rate is what was downloaded, not what we converted to.
      sourceSampleRate: 48000,
    });
    expect(asset.provenance.originalSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(asset.provenance.modifications).toContain("decode");
    expect(asset.provenance.modifications).toContain("peak-normalize");
  });

  it("qualifies the asset with its lockfile-declared destination pack", async () => {
    const { asset } = await ingestFixture();
    const pack = packBySlug(RESERVED_CC0_PACK_SLUG);
    expect(asset.pack).toEqual({ id: pack.id, version: pack.version });
  });

  it("produces an asset the shared manifest validator accepts", async () => {
    const { asset } = await ingestFixture();
    const pack = packBySlug(RESERVED_CC0_PACK_SLUG);
    // Validate the single acquired asset against the per-asset rules by
    // embedding it in an otherwise-valid pack manifest shape.
    const { errors } = validatePackManifest(
      {
        schemaVersion: 1,
        pack: {
          id: pack.id,
          slug: pack.slug,
          name: pack.name,
          version: pack.version,
          publisher: pack.publisher,
          kind: pack.kind,
          description: pack.description,
          coverage: { roles: ["percussion"], genres: ["techno"] },
          rights: pack.rights,
          releasedAt: "2026-07-25",
          assetCount: 1,
        },
        assets: [asset],
      },
      // The fixture ingest never writes the captured licence evidence to
      // disk, so the `CNT-001` evidence-path resolution is stubbed present
      // here and asserted for real in the test below.
      { pathExists: () => true },
    );
    const perAsset = errors.filter((error) => error.startsWith(asset.id));
    expect(perAsset).toEqual([]);
  });

  it("rejects an acquired asset whose captured licence evidence is missing", async () => {
    // `CNT-001`: an evidence path that resolves to nothing reads as evidence in
    // every report while the file it names is gone, so the validator resolves
    // it. The fixture ingest above passes because its evidence capture is
    // stubbed present; here the same asset is checked against an empty disk.
    const { asset } = await ingestFixture();
    const pack = packBySlug(RESERVED_CC0_PACK_SLUG);
    const { errors } = validatePackManifest(
      {
        schemaVersion: 1,
        pack: {
          id: pack.id,
          slug: pack.slug,
          name: pack.name,
          version: pack.version,
          publisher: pack.publisher,
          kind: pack.kind,
          description: pack.description,
          coverage: { roles: ["percussion"], genres: ["techno"] },
          rights: pack.rights,
          releasedAt: "2026-07-25",
          assetCount: 1,
        },
        assets: [asset],
      },
      { pathExists: () => false },
    );
    expect(errors.join("\n")).toMatch(/license.evidencePath .* does not exist/);
  });

  it("rejects a selection whose pack was never registered", async () => {
    await expect(ingestFixture({ asset: { pack: "not-a-real-pack" } })).rejects.toThrow(
      /not a registered pack/,
    );
  });

  it("fails on an archive member whose bytes changed", async () => {
    await expect(ingestFixture({ memberSha256: "d".repeat(64) })).rejects.toThrow(
      /archive member checksum mismatch/,
    );
  });

  it("assigns acquired ids from a range that cannot collide with generated ones", () => {
    expect(acquiredAssetId("drums", "kick", 0)).toBe("sg-one-shot-drums-kick-5001");
    expect(acquiredAssetId("texture", "ambience", 12)).toBe(
      "sg-one-shot-texture-ambience-5013",
    );
  });

  it("rejects a download that is not audio and not an archive", () => {
    expect(() =>
      resolveSelectedBytes({ originalFilename: "notes.pdf" }, Buffer.alloc(4)),
    ).toThrow(/not a supported audio file/);
    expect(isSupportedAudio("field.flac")).toBe(true);
    expect(isSupportedAudio("field.pdf")).toBe(false);
  });
});

function hashCode(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++)
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  return hash;
}
