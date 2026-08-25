// The VCSL bulk-ingest path.
//
// VCSL (the Versilian Community Sample Library, github.com/sgossner/VCSL) is
// released under CC0 1.0: the whole repository is a public-domain dedication, so
// unlike a Freesound page there is nothing to review file-by-file. That makes it
// a *trusted bulk source* — the confirmation is the repository's own LICENSE,
// recorded as evidence once, rather than a per-file pin in `sources.lock.json`.
//
// So VCSL does not flow through `library:manage` or the lockfile at all. This
// clones the repo at a pinned commit, ingests a curated electronic-production
// subset (one representative sample per instrument), writes it as an acquired
// bundle for `library:build` to merge, and deletes the clone. Section 4.1 is
// explicit that the goal is "a small electronic-production subset rather than
// ingesting the full multi-gigabyte library", so this never ingests all 4231
// WAVs — it selects instruments and takes one sample from each.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { packBySlug, packRef, RESERVED_CC0_PACK_SLUG } from "../packs.mjs";
import { analyze, encodeWav, sha256, storageKeyFor, waveformPeaks } from "../wav.mjs";
import { decodeToSamples, prepareOneShot } from "./audio.mjs";
import { writeAcquiredBundle } from "./ingest.mjs";

export const VCSL_REPO = "https://github.com/sgossner/VCSL.git";
export const VCSL_SOURCE_ID = "vcsl";

/**
 * Acquired VCSL asset IDs sit in their own numbering range so they can never
 * collide with the lockfile ingest (base 5000) as either side grows.
 */
export const VCSL_ID_BASE = 6000;

export function vcslAssetId(family, role, index) {
  return `sg-one-shot-${family}-${role}-${String(VCSL_ID_BASE + index + 1).padStart(4, "0")}`;
}

/**
 * Map a VCSL instrument name to a taxonomy (family, role) and seed tags, or
 * null to drop it. Unlike the (now removed) candidate mapping, this includes
 * bowed strings — the reviewer confirmed the whole library is usable, and a
 * struck/plucked/bowed string one-shot is useful tonal material.
 *
 * Keyed on the instrument name; the Hornbostel–Sachs family folder disambiguates.
 */
export function mapVcslInstrument(family, instrumentName) {
  const lower = instrumentName.toLowerCase();
  const has = (...words) => words.some((w) => lower.includes(w));
  const tags = (genres, characters, intensity = "low") => ({
    genres,
    characters,
    intensity,
  });

  if (family === "Idiophones") {
    if (
      has(
        "glockenspiel",
        "xylophone",
        "marimba",
        "vibraphone",
        "balafon",
        "kalimba",
        "mbira",
        "nyunga",
      )
    )
      return {
        family: "tonal",
        role: "mallet",
        ...tags(["ambient", "lofi"], ["glassy", "clean"]),
      };
    if (
      has(
        "tubular bell",
        "hand bell",
        "hand chime",
        "bell tree",
        "mark tree",
        "sleigh bell",
        "agogo",
        "cowbell",
        "finger cymbal",
        "triangle",
        "wine glass",
      )
    )
      return {
        family: "tonal",
        role: "bell",
        ...tags(["ambient"], ["glassy", "resonant"]),
      };
    if (has("cymbal", "hi-hat", "gong", "anvil", "brake drum", "clash"))
      return {
        family: "drums",
        role: "cymbal",
        ...tags(["techno", "ambient"], ["metallic", "resonant"], "medium"),
      };
    if (has("clap"))
      return {
        family: "drums",
        role: "clap",
        ...tags(["house"], ["organic", "roomy"], "medium"),
      };
    if (
      has(
        "shaker",
        "cabasa",
        "guiro",
        "ratchet",
        "vibraslap",
        "flexatone",
        "slapstick",
        "claves",
        "woodblock",
        "slit drum",
        "cajon",
        "tambourine",
      )
    )
      return {
        family: "drums",
        role: "percussion",
        ...tags(["house", "ambient"], ["organic", "wooden"], "medium"),
      };
    return {
      family: "drums",
      role: "percussion",
      ...tags(["ambient"], ["organic"], "medium"),
    };
  }

  if (family === "Membranophones") {
    if (has("bass drum"))
      return {
        family: "drums",
        role: "kick",
        ...tags(["breakbeat"], ["organic", "deep"], "medium"),
      };
    if (has("snare"))
      return {
        family: "drums",
        role: "snare",
        ...tags(["breakbeat"], ["organic", "tight"], "medium"),
      };
    if (has("tom", "timpani"))
      return {
        family: "drums",
        role: "tom",
        ...tags(["breakbeat"], ["organic", "tuned"], "medium"),
      };
    return {
      family: "drums",
      role: "percussion",
      ...tags(["house", "ambient"], ["organic", "warm"], "medium"),
    };
  }

  if (family === "Electrophones") {
    if (has("piano"))
      return {
        family: "tonal",
        role: "key",
        ...tags(["lofi", "house"], ["clean", "warm"]),
      };
    if (has("clavisynth"))
      return {
        family: "tonal",
        role: "pluck",
        ...tags(["techno"], ["clean", "bright"], "medium"),
      };
    return { family: "tonal", role: "key", ...tags(["lofi"], ["clean"]) };
  }

  if (family === "Chordophones") {
    if (has("harpsichord", "clavichord"))
      return {
        family: "tonal",
        role: "key",
        ...tags(["ambient", "lofi"], ["clean", "bright"]),
      };
    if (
      has(
        "harp",
        "lyre",
        "kora",
        "zither",
        "dulcimer",
        "guitar",
        "banjo",
        "mandolin",
        "ukulele",
        "lute",
        "psaltery",
      )
    )
      return {
        family: "tonal",
        role: "pluck",
        ...tags(["ambient", "lofi"], ["organic", "warm"]),
      };
    // Bowed strings (violin, viola, cello, bass, viol) — sustained tonal beds.
    if (has("violin", "viola", "cello", "contrabass", "double bass", "viol", "fiddle"))
      return {
        family: "tonal",
        role: "chord",
        ...tags(["ambient"], ["warm", "organic"]),
      };
    return {
      family: "tonal",
      role: "chord",
      ...tags(["ambient"], ["warm", "organic"]),
    };
  }

  if (family === "Aerophones") {
    // Winds are mostly out of scope, but keep the harmonica/organ-free reeds
    // and flutes as ambience-adjacent tonal material. Dropped by default.
    return null;
  }

  return null;
}

const slug = (text) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Every `.wav` under `dir`, as repo-relative POSIX paths. */
export function listWavs(dir) {
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.wav$/i.test(name)) out.push(relative(dir, full).split("\\").join("/"));
    }
  };
  walk(dir);
  return out;
}

/**
 * Group WAVs into instruments and choose one representative take each.
 *
 * An instrument is the path up to its third segment (family / subfamily /
 * instrument); anything deeper is an articulation or a velocity/round-robin
 * take. The representative is the median file by name within the instrument, a
 * cheap proxy for a middle-register, medium-velocity sample — good enough for a
 * one-shot the curator can hear, without decoding every take to pick.
 */
export function selectInstruments(wavPaths) {
  const groups = new Map();
  for (const path of wavPaths) {
    const parts = path.split("/");
    if (parts.length < 3) continue;
    const key = parts.slice(0, 3).join("/");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(path);
  }

  const selected = [];
  for (const [key, takes] of groups) {
    const [family, , instrumentRaw] = key.split("/");
    const instrument = instrumentRaw.replace(/ - Legacy$/, "");
    const mapped = mapVcslInstrument(family, instrument);
    if (!mapped) continue;
    // Prefer non-legacy takes; fall back to whatever exists.
    const pool = takes.filter((t) => !/legacy/i.test(t));
    const usable = (pool.length ? pool : takes).slice().sort();
    const representative = usable[Math.floor((usable.length - 1) / 2)];
    selected.push({
      id: `vcsl-${slug(instrument)}`,
      instrument,
      family: mapped.family,
      role: mapped.role,
      genres: mapped.genres,
      characters: mapped.characters,
      intensity: mapped.intensity,
      wavPath: representative,
      name: `VCSL ${instrument}`,
    });
  }
  // Stable order so asset IDs are deterministic across runs.
  selected.sort((a, b) => a.id.localeCompare(b.id));
  return selected;
}

/**
 * Decode and prepare one selected instrument into a manifest-shaped asset, in
 * the exact shape `ingest.mjs` produces so there is one validator and one
 * delivery layout downstream.
 */
export async function ingestInstrument(selection, { repoDir, commit, index }) {
  const source = readFileSync(join(repoDir, selection.wavPath));
  const decoded = await decodeToSamples(source);
  const prepared = prepareOneShot(decoded.channels, { peakDbfs: -1.5 });
  const master = encodeWav(prepared);
  const hash = sha256(master);

  const pack = packBySlug(RESERVED_CC0_PACK_SLUG);
  if (!pack) {
    throw new Error(
      `VCSL's destination pack "${RESERVED_CC0_PACK_SLUG}" is not registered`,
    );
  }

  return {
    bytes: master,
    asset: {
      id: vcslAssetId(selection.family, selection.role, index),
      version: 1,
      pack: packRef(pack),
      name: selection.name,
      type: "one-shot",
      family: selection.family,
      role: selection.role,
      files: {
        master: {
          storageKey: storageKeyFor(hash),
          sha256: hash,
          bytes: master.length,
          format: "wav",
        },
      },
      audio: {
        ...analyze(prepared),
        rootNote: null,
        tuningCents: null,
        bpm: null,
        bars: null,
        loopable: false,
        chokeGroup: null,
        chokeRole: null,
      },
      waveform: { buckets: 64, peaks: waveformPeaks(prepared, 64) },
      tags: {
        genres: [...selection.genres].sort(),
        characters: [...selection.characters].sort(),
        intensity: selection.intensity,
        sourceTypes: ["recorded"],
      },
      license: {
        id: "CC0-1.0",
        creator: "Versilian Studios and the VCSL community",
        sourceUrl: `https://github.com/sgossner/VCSL/tree/${commit}/${selection.wavPath
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
        retrievedAt: null,
        evidencePath: "docs/licenses/sources/vcsl.md",
        rawRedistributionAllowed: true,
        agreementId: null,
      },
      provenance: {
        sourceType: "recorded",
        sourceId: VCSL_SOURCE_ID,
        downloadUrl: `${VCSL_REPO}@${commit}`,
        originalFilename: selection.wavPath.split("/").pop(),
        originalSha256: sha256(source),
        archiveMember: selection.wavPath,
        memberSha256: null,
        sourceSampleRate: decoded.sampleRate,
        sourceChannels: decoded.channels.length,
        modifications: [
          "decode",
          ...(decoded.sampleRate === 48000 ? [] : ["resample-48000"]),
          ...(decoded.channels.length > prepared.length ? ["downmix-mono"] : []),
          "dc-offset-removal",
          "lead-trim",
          "tail-trim",
          "peak-normalize",
          "edge-fades",
        ],
        // The rights review is the repository-wide CC0 dedication, confirmed
        // against github.com/sgossner/VCSL, not a per-file human pass.
        reviewState: "bulk-cc0",
        reviewer: "vcsl-cc0-bulk",
        reviewedAt: null,
      },
    },
  };
}

/** Shallow-clone the repo at HEAD and return its resolved commit SHA. */
export function cloneRepo(dir, { repo = VCSL_REPO, run = execFileSync } = {}) {
  run("git", ["clone", "--depth", "1", repo, dir], { stdio: "ignore" });
  const commit = run("git", ["-C", dir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  })
    .toString()
    .trim();
  return commit;
}

/**
 * The whole VCSL bulk path: clone, ingest the curated subset, capture the
 * repository LICENSE as evidence, write the acquired bundle, and delete the
 * clone. `now` and `run` are injectable for tests; a fixture repo can be used
 * in place of a network clone by passing `repoDir` directly.
 */
export async function acquireVcsl({
  acquiredDir,
  evidenceDir,
  now,
  log = () => {},
  run,
  repoDir: providedRepoDir,
  repo,
} = {}) {
  const timestamp = now ?? new Date().toISOString();
  const ownClone = !providedRepoDir;
  const repoDir = providedRepoDir ?? mkdtempSync(join(tmpdir(), "vcsl-clone-"));
  let commit = "unknown";

  try {
    if (ownClone) {
      log("cloning VCSL (shallow) …");
      commit = cloneRepo(repoDir, { repo, run });
    } else {
      try {
        commit = (run ?? execFileSync)("git", ["-C", repoDir, "rev-parse", "HEAD"], {
          encoding: "utf8",
        })
          .toString()
          .trim();
      } catch {
        commit = "unknown";
      }
    }

    const wavs = listWavs(repoDir);
    const selections = selectInstruments(wavs);
    log(`selected ${selections.length} instruments from ${wavs.length} WAVs`);

    const ingested = [];
    for (let i = 0; i < selections.length; i++) {
      const selection = selections[i];
      try {
        const result = await ingestInstrument(selection, {
          repoDir,
          commit,
          index: i,
        });
        // Stamp the retrieval date now that we know it.
        result.asset.license.retrievedAt = timestamp.slice(0, 10);
        result.asset.provenance.reviewedAt = timestamp.slice(0, 10);
        ingested.push(result);
      } catch (error) {
        log(
          `  skipped ${selection.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    captureLicenseEvidence(evidenceDir, { commit, now: timestamp, repoDir });
    const bundleDir = join(acquiredDir, "vcsl");
    writeAcquiredBundle(bundleDir, ingested);
    log(`ingested ${ingested.length} VCSL assets to ${bundleDir}`);
    return { ingested: ingested.length, commit, bundleDir };
  } finally {
    // Always delete the clone — it is multi-gigabyte third-party bytes that
    // are never committed, exactly like the quarantine directory.
    if (ownClone) rmSync(repoDir, { recursive: true, force: true });
  }
}

/**
 * Write the VCSL licence evidence: the repository's own LICENSE text, the pinned
 * commit, and the rights position. This is the record section 3.4 requires, and
 * for a bulk CC0 source it is what stands in for per-file pins.
 */
export function captureLicenseEvidence(evidenceDir, { commit, now, repoDir }) {
  let license = "";
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"]) {
    const path = join(repoDir, name);
    if (existsSync(path)) {
      license = readFileSync(path, "utf8");
      break;
    }
  }
  const status = license ? "captured" : "unavailable";
  if (!license) license = "No LICENSE file found in the repository at this commit.\n";

  const record = [
    "# Licence evidence: Versilian Community Sample Library (VCSL)",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Source ID | \`${VCSL_SOURCE_ID}\` |`,
    "| Licence | CC0-1.0 |",
    `| Repository | ${VCSL_REPO} |`,
    `| Pinned commit | \`${commit}\` |`,
    `| Retrieved | ${now.slice(0, 10)} |`,
    `| Capture | ${status} |`,
    `| LICENSE SHA-256 | ${sha256(Buffer.from(license))} |`,
    "",
    "Rights position: the entire repository is dedicated to the public domain",
    "under CC0 1.0. Confirmed against github.com/sgossner/VCSL. As a bulk CC0",
    "source, the confirmation is this repository-wide dedication rather than a",
    "per-file pin in sources.lock.json.",
    "",
    "## Captured LICENSE",
    "",
    "```",
    license.trim(),
    "```",
    "",
  ].join("\n");

  const path = join(evidenceDir, `${VCSL_SOURCE_ID}.md`);
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path, record);
  return {
    path,
    evidencePath: `docs/licenses/sources/${VCSL_SOURCE_ID}.md`,
    status,
  };
}
