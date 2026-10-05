#!/usr/bin/env node
// The content release audit (docs/sample-library.md section 13 Phase D and the
// section 17 alpha checklist; issue #78).
//
//   bun run library:audit            # build in memory, audit, print the report
//   bun run library:audit -- --json  # the same report as JSON
//
// `library:validate` proves every manifest *record* is well formed. This audit
// goes one step further and checks the records against the bytes that would
// actually ship, then against each other, so a release is judged on what a
// producer would download rather than on what a manifest says about it:
//
//   pack          each pack against its coverage claim and its rights position,
//                 and its statement of what it does not contain (section 6.5)
//   missing-file  every manifest entry has a delivered file, and every file
//                 belongs to an entry
//   decode        every WAV master decodes, matches its checksum, and agrees
//                 with the format, rate, channels and length its record states;
//                 every preset parses
//   loudness      the measured peak agrees with the record, leaves headroom and
//                 is not silent; very quiet or brick-walled audio is flagged
//   tuning        every pitched asset carries a root note and tuning metadata
//   loop-boundary every loop is re-measured from its bytes: on its bar grid and
//                 seamless over 32 cycles, as its record claims
//   duplicates    no byte-identical master in two packs, and identical waveform
//                 overviews flagged for review by ear
//
// Errors fail the audit (exit 1). Warnings are findings a curator reviews: they
// are printed, never silently dropped, and never fail the run.

import { gzipSync } from "node:zlib";
import { readLockfile, validateLockfile } from "./acquire/lockfile.mjs";
import { dbfs } from "./dsp.mjs";
import { analyzeSeam, verifyGrid } from "./loops.mjs";
import { buildAllPacks, serialize } from "./manifest.mjs";
import { repoPathExists, validatePackManifest } from "./validate.mjs";
import { sha256 } from "./wav.mjs";

/** The audits, in report order. */
export const AUDITS = [
  "pack",
  "missing-file",
  "decode",
  "loudness",
  "tuning",
  "loop-boundary",
  "duplicates",
];

/** Section 10: a master never peaks above this (the validator's own ceiling). */
export const MAX_PEAK_DBFS = -0.1;
/** How far a measured peak may drift from the record before it is a lie, in dB. */
export const PEAK_TOLERANCE_DB = 0.1;
/**
 * Below this RMS an asset is too quiet to audition at a reasonable level
 * (section 10: "perceptually reasonable audition levels"). The synthesized
 * library's quietest asset sits near -25 dBFS.
 */
export const MIN_RMS_DBFS = -40;
/**
 * A peak this close to the RMS has had its dynamics flattened: section 10's
 * "do not brick-wall normalize the collection". Sustained tones (drones, subs)
 * legitimately sit close, so this is a finding to review, not a failure.
 */
export const MIN_CREST_DB = 3;
/** Section 10: a tuning reading further than this from the root is a wrong root. */
export const MAX_TUNING_CENTS = 50;
/** Families whose one-shots are pitched and must carry a root note. */
export const PITCHED_FAMILIES = ["bass", "tonal"];
/**
 * Section 6.5: "Every pack states what it does not contain". Packs phrase it as
 * "Contains no ..." or "does not contain ...".
 */
const STATES_EXCLUSIONS = /\b(contains no|does not contain)\b/i;

/**
 * Decode a 24-bit PCM WAV master into per-channel float samples. Walks the RIFF
 * chunks rather than assuming a 44-byte header, so a master written by another
 * tool still decodes, and throws with a reason on anything malformed: a decode
 * failure here is a sound that would fail in every browser.
 *
 * @returns {{ channels: number, sampleRate: number, bitDepth: number, frames: number, samples: Float32Array[] }}
 */
export function decodeWav(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length < 12) throw new Error("file is too short to be a WAV");
  if (buffer.toString("ascii", 0, 4) !== "RIFF") throw new Error("no RIFF header");
  if (buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAVE file");

  let format = null;
  let data = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > buffer.length) {
      throw new Error(`chunk "${id}" runs past the end of the file`);
    }
    if (id === "fmt ") {
      format = {
        code: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        blockAlign: buffer.readUInt16LE(body + 12),
        bitDepth: buffer.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = { start: body, size };
    }
    // Chunks are word-aligned: an odd size is followed by one pad byte.
    offset = body + size + (size % 2);
  }

  if (!format) throw new Error("no fmt chunk");
  if (!data) throw new Error("no data chunk");
  if (format.code !== 1) throw new Error(`format ${format.code} is not PCM`);
  if (format.bitDepth !== 24) throw new Error(`${format.bitDepth}-bit, not 24-bit`);
  if (format.channels < 1) throw new Error("no channels");
  if (format.blockAlign !== format.channels * 3) {
    throw new Error("block alignment does not match the channel count");
  }
  if (data.size % format.blockAlign !== 0) {
    throw new Error("data chunk is not a whole number of frames");
  }

  const frames = data.size / format.blockAlign;
  const scale = 2 ** 23 - 1;
  const samples = Array.from({ length: format.channels }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < format.channels; channel++) {
      const at = data.start + (frame * format.channels + channel) * 3;
      samples[channel][frame] = buffer.readIntLE(at, 3) / scale;
    }
  }
  return {
    channels: format.channels,
    sampleRate: format.sampleRate,
    bitDepth: format.bitDepth,
    frames,
    samples,
  };
}

/** Peak and RMS across every channel, in dBFS. */
export function measureLevels(samples) {
  let peak = 0;
  let squares = 0;
  let count = 0;
  for (const channel of samples) {
    for (const value of channel) {
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
      squares += value * value;
    }
    count += channel.length;
  }
  return {
    peakDbfs: dbfs(peak),
    rmsDbfs: dbfs(count === 0 ? 0 : Math.sqrt(squares / count)),
  };
}

/**
 * Audit a built library: `buildAllPacks()`'s `{ files, packManifests }`.
 *
 * @returns {{ packs: object[], findings: object[], errors: number, warnings: number }}
 */
export function auditRelease(
  { files, packManifests },
  { pathExists = repoPathExists } = {},
) {
  const findings = [];
  const report = (audit, severity, pack, message, assetId = null) => {
    findings.push({ audit, severity, pack, assetId, message });
  };

  const bytesByKey = new Map(files.map((file) => [file.storageKey, file.bytes]));
  const packs = packManifests.map((manifest) =>
    auditPack(manifest, { report, pathExists }),
  );

  auditMissingFiles(packManifests, bytesByKey, report);
  for (const manifest of packManifests) {
    for (const asset of manifest.assets) {
      const bytes = bytesByKey.get(asset.files?.master?.storageKey);
      if (bytes) auditAssetBytes(asset, bytes, manifest.pack.slug, report);
      auditTuning(asset, manifest.pack.slug, report);
    }
  }
  auditDuplicates(packManifests, report);

  for (const pack of packs) {
    const own = findings.filter((finding) => finding.pack === pack.slug);
    pack.errors = own.filter((finding) => finding.severity === "error").length;
    pack.warnings = own.filter((finding) => finding.severity === "warning").length;
  }
  return {
    packs,
    findings,
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
  };
}

/**
 * One pack against its coverage claim and its rights position (section 17:
 * "Every shipped pack meets its coverage claim ... and states what it does not
 * contain"; "no asset's licence terms exceed its pack's rights position").
 *
 * The record-level rules are `validatePackManifest`'s, run here so the audit is
 * one self-contained verdict per pack. Coverage is then reported both ways:
 * what the pack claims and does not deliver fails, and what it delivers but
 * does not claim is listed, so a curator can see the claim is honest.
 */
function auditPack(manifest, { report, pathExists }) {
  const { pack, assets } = manifest;
  const slug = pack.slug;

  const { errors } = validatePackManifest(manifest, {
    serialized: serialize(manifest),
    pathExists,
  });
  for (const error of errors) report("pack", "error", slug, error);

  if (!STATES_EXCLUSIONS.test(pack.description ?? "")) {
    report(
      "pack",
      "error",
      slug,
      "description does not state what the pack does not contain",
    );
  }

  const deliveredRoles = unique(assets.map((asset) => asset.role));
  const deliveredGenres = unique(assets.flatMap((asset) => asset.tags?.genres ?? []));
  const coverage = pack.coverage ?? null;
  if (!coverage) {
    report(
      "pack",
      "warning",
      slug,
      "states no coverage claim, so there is nothing to audit it against",
    );
  }

  return {
    slug,
    name: pack.name,
    version: pack.version,
    kind: pack.kind,
    assets: assets.length,
    rights: {
      licence: pack.rights?.licence ?? null,
      rawRedistribution: pack.rights?.rawRedistribution === true,
      attributionRequired: pack.rights?.attributionRequired === true,
    },
    coverage: coverage
      ? {
          roles: [...coverage.roles],
          genres: [...coverage.genres],
          unclaimedRoles: deliveredRoles.filter((role) => !coverage.roles.includes(role)),
          unclaimedGenres: deliveredGenres.filter(
            (genre) => !coverage.genres.includes(genre),
          ),
        }
      : null,
    manifestGzipBytes: gzipSync(Buffer.from(serialize(manifest))).length,
    errors: 0,
    warnings: 0,
  };
}

/**
 * Section 17: "No asset depends on a third-party URL remaining live" and
 * "Every audio file resolves through a stable asset ID". An entry with no
 * delivered file is a sound every project using it would lose; a delivered
 * file no entry names is a sound nobody can reach and nobody audited.
 */
function auditMissingFiles(packManifests, bytesByKey, report) {
  const referenced = new Set();
  for (const { pack, assets } of packManifests) {
    for (const asset of assets) {
      const key = asset.files?.master?.storageKey;
      if (!key) continue; // the validator already rejects a missing master
      referenced.add(key);
      const bytes = bytesByKey.get(key);
      if (!bytes) {
        report(
          "missing-file",
          "error",
          pack.slug,
          `no delivered file at ${key}`,
          asset.id,
        );
      } else if (bytes.length !== asset.files.master.bytes) {
        report(
          "missing-file",
          "error",
          pack.slug,
          `delivered file is ${bytes.length} bytes, the record says ${asset.files.master.bytes}`,
          asset.id,
        );
      }
    }
  }
  for (const key of bytesByKey.keys()) {
    if (!referenced.has(key)) {
      report("missing-file", "error", null, `delivered file ${key} belongs to no asset`);
    }
  }
}

/** Decode, loudness and loop-boundary: everything read off the shipped bytes. */
function auditAssetBytes(asset, bytes, slug, report) {
  const master = asset.files.master;
  if (sha256(bytes) !== master.sha256) {
    report(
      "decode",
      "error",
      slug,
      "delivered bytes do not match the recorded SHA-256",
      asset.id,
    );
    return;
  }

  if (master.format === "json") {
    try {
      JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch (error) {
      report(
        "decode",
        "error",
        slug,
        `preset does not parse: ${error.message}`,
        asset.id,
      );
    }
    return;
  }

  let decoded;
  try {
    decoded = decodeWav(bytes);
  } catch (error) {
    report("decode", "error", slug, `does not decode: ${error.message}`, asset.id);
    return;
  }
  const audio = asset.audio ?? {};
  const mismatch = (what, actual, declared) =>
    report(
      "decode",
      "error",
      slug,
      `decodes as ${what} ${actual}, the record says ${declared}`,
      asset.id,
    );
  if (decoded.sampleRate !== audio.sampleRate) {
    mismatch("sample rate", decoded.sampleRate, audio.sampleRate);
  }
  if (decoded.channels !== audio.channels) {
    mismatch("channels", decoded.channels, audio.channels);
  }
  const seconds = decoded.frames / decoded.sampleRate;
  // The record rounds to 4 places; anything further out is a different file.
  if (Math.abs(seconds - audio.durationSeconds) > 0.0001) {
    mismatch("duration", `${seconds.toFixed(4)}s`, `${audio.durationSeconds}s`);
  }

  auditLoudness(asset, decoded, slug, report);
  if (asset.type === "loop") auditLoopBoundary(asset, decoded, slug, report);
}

function auditLoudness(asset, decoded, slug, report) {
  const { peakDbfs, rmsDbfs } = measureLevels(decoded.samples);
  if (!Number.isFinite(peakDbfs)) {
    report("loudness", "error", slug, "is silent", asset.id);
    return;
  }
  if (peakDbfs > MAX_PEAK_DBFS) {
    report(
      "loudness",
      "error",
      slug,
      `peaks at ${peakDbfs.toFixed(2)} dBFS, above the ${MAX_PEAK_DBFS} dBFS ceiling`,
      asset.id,
    );
  }
  if (Math.abs(peakDbfs - asset.audio.peakDbfs) > PEAK_TOLERANCE_DB) {
    report(
      "loudness",
      "error",
      slug,
      `measures ${peakDbfs.toFixed(2)} dBFS peak, the record says ${asset.audio.peakDbfs}`,
      asset.id,
    );
  }
  if (rmsDbfs < MIN_RMS_DBFS) {
    report(
      "loudness",
      "warning",
      slug,
      `RMS ${rmsDbfs.toFixed(1)} dBFS is below ${MIN_RMS_DBFS} dBFS: too quiet to audition`,
      asset.id,
    );
  }
  if (peakDbfs - rmsDbfs < MIN_CREST_DB) {
    report(
      "loudness",
      "warning",
      slug,
      `crest factor ${(peakDbfs - rmsDbfs).toFixed(1)} dB: review for brick-wall limiting`,
      asset.id,
    );
  }
}

/**
 * Section 10, "Loops", re-measured from the delivered bytes rather than read
 * back from the record the build wrote: on its bar grid, sample-aligned, and
 * seamless over 32 repeated cycles.
 */
function auditLoopBoundary(asset, decoded, slug, report) {
  const { bpm, bars, timeSignature } = asset.audio;
  const grid = verifyGrid(
    decoded.samples,
    { bpm, bars, timeSignature },
    decoded.sampleRate,
  );
  if (!grid.sampleAligned) {
    report(
      "loop-boundary",
      "error",
      slug,
      `${bars} bar(s) at ${bpm} BPM is not a whole number of samples`,
      asset.id,
    );
  }
  if (grid.errorSamples !== 0) {
    report(
      "loop-boundary",
      "error",
      slug,
      `is ${grid.errorSamples} samples off the ${bpm} BPM bar grid`,
      asset.id,
    );
  }
  const seam = analyzeSeam(decoded.samples);
  if (!seam.seamless) {
    report(
      "loop-boundary",
      "error",
      slug,
      `clicks at the loop point over ${seam.cyclesVerified} cycles (${seam.wrapStepDbfs} dBFS step against ${seam.interiorStepDbfs} dBFS inside)`,
      asset.id,
    );
  }
}

/**
 * Section 17: "all tonal assets have reviewed tuning metadata". A pitched
 * one-shot without a root cannot be played in key; a root without a tuning
 * reading, or one further than a quarter-tone out, is a root nobody checked.
 * A derived master's pitch moved with its transform, so a missing root there is
 * a finding to review rather than a failure.
 */
function auditTuning(asset, slug, report) {
  const audio = asset.audio;
  if (!audio) return; // a preset carries no audio of its own
  const pitched =
    PITCHED_FAMILIES.includes(asset.family) &&
    ["one-shot", "derived"].includes(asset.type);
  if (audio.rootNote === null || audio.rootNote === undefined) {
    if (!pitched) return;
    report(
      "tuning",
      asset.type === "derived" ? "warning" : "error",
      slug,
      asset.type === "derived"
        ? "pitched derived master has no root note; review its tuning"
        : "pitched one-shot has no root note",
      asset.id,
    );
    return;
  }
  if (typeof audio.tuningCents !== "number") {
    report(
      "tuning",
      "error",
      slug,
      `root ${audio.rootNote} has no tuning reading`,
      asset.id,
    );
  } else if (Math.abs(audio.tuningCents) > MAX_TUNING_CENTS) {
    report(
      "tuning",
      "error",
      slug,
      `is ${audio.tuningCents} cents from its root ${audio.rootNote}, past ${MAX_TUNING_CENTS}`,
      asset.id,
    );
  }
}

/**
 * Section 6.1: "Duplicates ... do not count." The validator rejects a
 * byte-identical pair inside one pack; across packs the delivery layout would
 * quietly collapse them into one object, so the audit is where it is caught.
 * Section 10 asks for near duplicates to be found "using audio fingerprints and
 * human review": two masters with the same length and the same 48-bin overview
 * are flagged for a listen, not rejected.
 */
function auditDuplicates(packManifests, report) {
  const byHash = new Map();
  const byFingerprint = new Map();
  for (const { pack, assets } of packManifests) {
    for (const asset of assets) {
      const hash = asset.files?.master?.sha256;
      if (hash) {
        const first = byHash.get(hash);
        if (first && first.pack !== pack.slug) {
          report(
            "duplicates",
            "error",
            pack.slug,
            `byte-identical to ${first.id} in ${first.pack}`,
            asset.id,
          );
        } else if (!first) {
          byHash.set(hash, { id: asset.id, pack: pack.slug });
        }
      }
      if (Array.isArray(asset.peaks) && asset.audio) {
        const key = `${asset.audio.durationSeconds}|${asset.peaks.join(",")}`;
        const first = byFingerprint.get(key);
        if (first && first.hash !== hash) {
          report(
            "duplicates",
            "warning",
            pack.slug,
            `same length and waveform as ${first.id}: review by ear for a near duplicate`,
            asset.id,
          );
        } else if (!first) {
          byFingerprint.set(key, { id: asset.id, hash });
        }
      }
    }
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}

/** The human report: one line per pack, then every finding grouped by audit. */
export function formatAuditReport(result) {
  const lines = ["release audit (docs/sample-library.md sections 13 Phase D, 17)", ""];
  lines.push("packs:");
  for (const pack of result.packs) {
    const verdict = pack.errors > 0 ? "FAIL" : "pass";
    const claim = pack.coverage
      ? `${pack.coverage.roles.length} roles, ${pack.coverage.genres.length} genres claimed`
      : "no coverage claim";
    lines.push(
      `  ${verdict}  ${pack.slug.padEnd(24)} v${pack.version}  ${String(pack.assets).padStart(4)} assets  ${String(pack.rights.licence).padEnd(18)} ${claim}`,
    );
  }
  for (const audit of AUDITS) {
    const own = result.findings.filter((finding) => finding.audit === audit);
    const errors = own.filter((finding) => finding.severity === "error").length;
    const warnings = own.length - errors;
    lines.push("", `${audit}: ${errors} error(s), ${warnings} warning(s)`);
    for (const finding of own) {
      const where = [finding.pack, finding.assetId].filter(Boolean).join(" ");
      lines.push(
        `  ${finding.severity.padEnd(7)} ${where ? `${where}: ` : ""}${finding.message}`,
      );
    }
  }
  lines.push(
    "",
    `${result.errors} error(s), ${result.warnings} warning(s) across ${result.packs.length} pack(s)`,
  );
  return lines.join("\n");
}

export function parseArgs(argv) {
  const args = { json: false };
  for (const flag of argv) {
    if (flag === "--json") args.json = true;
    else throw new Error(`unknown flag: ${flag}`);
  }
  return args;
}

/** Build in memory and audit: exactly the bytes `library:upload` would publish. */
export function runAudit({ build = buildAllPacks } = {}) {
  const lockfileErrors = validateLockfile(readLockfile());
  const result = auditRelease(build());
  for (const error of lockfileErrors) {
    result.findings.unshift({
      audit: "pack",
      severity: "error",
      pack: null,
      assetId: null,
      message: `sources.lock.json: ${error}`,
    });
    result.errors++;
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = runAudit();
    console.log(args.json ? JSON.stringify(result, null, 2) : formatAuditReport(result));
    if (result.errors > 0) process.exit(1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
