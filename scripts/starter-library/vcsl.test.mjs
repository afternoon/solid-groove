import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  acquireVcsl,
  captureLicenseEvidence,
  listWavs,
  mapVcslInstrument,
  selectInstruments,
  VCSL_ID_BASE,
  vcslAssetId,
} from "./acquire/vcsl.mjs";
import { loadAcquiredAssets } from "./manifest.mjs";
import { encodeWav } from "./wav.mjs";

const cleanups = [];
afterAll(() => {
  for (const cleanup of cleanups) cleanup();
});

function fixtureWav(rate = 44100, seconds = 0.4) {
  const frames = Math.round(seconds * rate);
  const out = new Float32Array(frames);
  for (let i = Math.round(0.05 * rate); i < frames; i++) {
    const t = (i - 0.05 * rate) / rate;
    out[i] = Math.sin(2 * Math.PI * 220 * t) * Math.exp(-t * 6) * 0.7;
  }
  return encodeWav(out, rate);
}

/** Build a tiny VCSL-shaped repo on disk with real, decodable WAVs. */
function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "vcsl-fixture-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const files = [
    // An idiophone mallet, two takes.
    "Idiophones/Struck Idiophones/Marimba/Marimba_mp_C4.wav",
    "Idiophones/Struck Idiophones/Marimba/Marimba_mp_C5.wav",
    "Idiophones/Struck Idiophones/Marimba/Marimba_mp_C6.wav",
    // A bell.
    "Idiophones/Struck Idiophones/Tubular Bells 1/Bell_C4.wav",
    // A membranophone (conga -> percussion).
    "Membranophones/Struck Drums/Conga/Conga_hit_1.wav",
    // A bowed string — must be INCLUDED now (chord).
    "Chordophones/Bowed Strings/Concert Cello/Cello_sus_C2.wav",
    // A plucked string.
    "Chordophones/Composite Chordophones/Concert Harp/Harp_C4.wav",
    // An aerophone — must be DROPPED.
    "Aerophones/Edge-blown Aerophones/Baroque Alto Recorder/Recorder_C5.wav",
  ];
  for (const rel of files) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, fixtureWav());
  }
  writeFileSync(join(dir, "LICENSE"), "CC0 1.0 Universal — public domain.\n");
  return dir;
}

describe("VCSL instrument mapping", () => {
  it("maps mallets, bells, percussion, plucked and bowed strings", () => {
    expect(mapVcslInstrument("Idiophones", "Marimba").role).toBe("mallet");
    expect(mapVcslInstrument("Idiophones", "Tubular Bells 1").role).toBe("bell");
    expect(mapVcslInstrument("Membranophones", "Conga").role).toBe("percussion");
    expect(mapVcslInstrument("Chordophones", "Concert Harp").role).toBe("pluck");
    // Strings are included now (they were dropped in the candidate mapping).
    expect(mapVcslInstrument("Chordophones", "Concert Cello")).toMatchObject({
      family: "tonal",
      role: "chord",
    });
  });

  it("drops aerophones (winds/organs) as out of scope", () => {
    expect(mapVcslInstrument("Aerophones", "Baroque Alto Recorder")).toBeNull();
  });
});

describe("selecting one representative sample per instrument", () => {
  it("groups takes by instrument and picks a single middle take", () => {
    const repo = fixtureRepo();
    const selections = selectInstruments(listWavs(repo));
    // Marimba(1) + Tubular Bells(1) + Conga(1) + Cello(1) + Harp(1) = 5;
    // the recorder is dropped.
    expect(selections).toHaveLength(5);
    const marimba = selections.find((s) => s.instrument === "Marimba");
    // Median of the 3 sorted takes is the C5 file.
    expect(marimba.wavPath).toMatch(/Marimba_mp_C5\.wav$/);
    expect(selections.some((s) => /Recorder/.test(s.wavPath))).toBe(false);
  });
});

describe("acquired asset IDs", () => {
  it("sit in a range disjoint from the lockfile ingest (base 5000)", () => {
    expect(VCSL_ID_BASE).toBeGreaterThanOrEqual(6000);
    expect(vcslAssetId("tonal", "mallet", 0)).toBe("sg-one-shot-tonal-mallet-6001");
  });
});

describe("licence evidence", () => {
  it("captures the repo LICENSE, pinned commit, and CC0 position", () => {
    const repo = fixtureRepo();
    const evidenceDir = mkdtempSync(join(tmpdir(), "vcsl-evidence-"));
    cleanups.push(() => rmSync(evidenceDir, { recursive: true, force: true }));
    const record = captureLicenseEvidence(evidenceDir, {
      commit: "abc123",
      now: "2026-07-26T00:00:00.000Z",
      repoDir: repo,
    });
    expect(record.status).toBe("captured");
    const text = readFileSync(record.path, "utf8");
    expect(text).toMatch(/CC0-1\.0/);
    expect(text).toMatch(/abc123/);
    expect(text).toMatch(/public domain/i);
  });
});

describe("acquireVcsl end to end (offline, against a fixture repo)", () => {
  it("ingests the subset, writes a bundle, and never clones", async () => {
    const repo = fixtureRepo();
    const acquiredDir = mkdtempSync(join(tmpdir(), "vcsl-acquired-"));
    const evidenceDir = mkdtempSync(join(tmpdir(), "vcsl-ev-"));
    cleanups.push(() => rmSync(acquiredDir, { recursive: true, force: true }));
    cleanups.push(() => rmSync(evidenceDir, { recursive: true, force: true }));

    // A `run` that would throw if a clone were attempted, proving the fixture
    // path never shells out to git for the clone.
    const run = (_cmd, argv) => {
      if (argv.includes("clone")) throw new Error("must not clone in this test");
      return "fixturecommit\n";
    };

    const result = await acquireVcsl({
      acquiredDir,
      evidenceDir,
      now: "2026-07-26T00:00:00.000Z",
      repoDir: repo, // provided -> no clone, no cleanup of the fixture
      run,
    });

    expect(result.ingested).toBe(5);
    expect(result.commit).toBe("fixturecommit");
    // The bundle exists and is under a `vcsl/` subdir.
    expect(existsSync(join(acquiredDir, "vcsl", "entries.json"))).toBe(true);
    // The fixture repo is NOT deleted (we provided it), so it can be reused.
    expect(existsSync(repo)).toBe(true);

    // manifest.loadAcquiredAssets merges the bundle by directory.
    const loaded = loadAcquiredAssets(acquiredDir);
    expect(loaded).toHaveLength(5);
    for (const { asset } of loaded) {
      expect(asset.id).toMatch(/^sg-one-shot-.+-6\d{3}$/);
      expect(asset.license.id).toBe("CC0-1.0");
      expect(asset.provenance.sourceId).toBe("vcsl");
      expect(asset.provenance.reviewState).toBe("bulk-cc0");
      expect(asset.tags.sourceTypes).toEqual(["recorded"]);
    }
  });
});
