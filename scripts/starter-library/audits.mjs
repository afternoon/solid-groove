// Library-wide audio audits (docs/sample-library.md section 10).
//
// The per-asset rules in `validate.mjs` judge one record at a time. These judge
// an asset against the rest of the library, which is the only way to answer
// "is this one wildly louder than every other kick?". They read measurements the
// build already wrote into each manifest entry (`manifest.mjs`,
// `measureDelivered`), so they run on the manifests alone and never touch audio.
//
// Every audit *flags*; none of them changes a sample. Section 10 forbids
// brick-wall normalizing the collection, so an outlier is a decision for a
// person — re-prepare the file or retire it — never something the build quietly
// corrects. That is also why a loudness outlier is a warning, not an error: a
// sparse sound with a long decay (a plucked chord, a bowed swell) measures far
// under a band of dense hits and is exactly the useful dynamics section 10 keeps.
// What fails is a missing measurement (`validate.mjs`), never a quiet sound.

import { SKETCH_STEPS_PER_DB } from "./dsp.mjs";

/**
 * How far, in LU, an asset's integrated loudness may sit from the median of its
 * role band before it is reported as an outlier for a person to audition.
 *
 * Wide on purpose. Section 10 wants useful dynamics kept, so a quiet texture
 * among loud ones is not a defect, and K-weighting reads sub-heavy material
 * several LU quieter than it sounds on a full-range system (the synthesized
 * octave-down sub sits 8.6 LU under its band for exactly that reason). 12 LU is
 * roughly four times as loud or a quarter as loud as the rest of the band: a
 * level an audition cannot have been prepared for.
 */
export const LOUDNESS_OUTLIER_LU = 12;

/**
 * A band needs this many measured assets before its median means anything.
 * A thinner band is compared against its family's median instead.
 */
export const MIN_LOUDNESS_BAND = 3;

/**
 * How far a detected pitch may sit from the declared root, in cents.
 *
 * 50 cents is where the nearest note changes: past it, the `rootNote` names the
 * wrong semitone and a sampler mapping the sound by it plays every key out of
 * tune. Inside it the recorded `tuningCents` is the fine correction, which is
 * metadata, not a fault. Every detected synthesized sound measures within ±9.
 */
export const TUNING_TOLERANCE_CENTS = 50;

/**
 * When two audio assets are near duplicates: all three distances inside their
 * limits at once. Calibrated on the synthesized library, where deliberate
 * variations of one voice (kicks a few parameters apart, the same sub at two
 * notes) sit just outside at least one limit, while a copy that was only
 * re-gained, re-encoded or trimmed by a few percent sits well inside all three.
 */
export const NEAR_DUPLICATE = {
  /** Lengths within 10% of each other (|ln ratio| ≤ ln 1.1). */
  maxDurationRatio: 1.1,
  /** Mean absolute difference of the 48-bin `peaks` envelopes, as a share of full scale. */
  maxEnvelopeDistance: 0.03,
  /** Mean absolute difference of the spectral sketches, in dB per band. */
  maxSpectralDistanceDb: 1,
};

/** What `measureTuning` (`dsp.mjs`) can say about a sound's pitch. */
export const TUNING_STATUSES = ["detected", "undetectable", "gliding"];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Warn about every audio asset whose integrated loudness is more than
 * `LOUDNESS_OUTLIER_LU` from the median of its role band (`family/role`,
 * across every pack and asset type). A missing or unmeasurable loudness is the
 * per-asset validator's error to report, so those assets are skipped here.
 *
 * A band mixes one-shots and loops on purpose. Splitting by type would leave
 * most loop bands under `MIN_LOUDNESS_BAND` and fall back to the family median,
 * which mixes them again; and an audition plays both at the level they were
 * prepared at. The cost is that a dense loop reads a few LU louder than a
 * single hit of the same role, which the 12 LU limit absorbs.
 *
 * @returns {{ errors: string[], warnings: string[], bands: Map<string, {median: number, count: number}> }}
 */
export function auditLoudness(assets, { toleranceLu = LOUDNESS_OUTLIER_LU } = {}) {
  const warnings = [];
  const measured = assets.filter((asset) => Number.isFinite(asset.audio?.loudnessLufs));
  const loudnessOf = (asset) => asset.audio.loudnessLufs;

  const familyMedians = new Map(
    [...groupBy(measured, (asset) => asset.family)].map(([family, group]) => [
      family,
      median(group.map(loudnessOf)),
    ]),
  );

  const bands = new Map();
  for (const [band, group] of groupBy(
    measured,
    (asset) => `${asset.family}/${asset.role}`,
  )) {
    const thin = group.length < MIN_LOUDNESS_BAND;
    const reference = thin
      ? familyMedians.get(group[0].family)
      : median(group.map(loudnessOf));
    const against = thin ? `the ${group[0].family} family` : `the ${band} band`;
    bands.set(band, { median: round1(reference), count: group.length });
    for (const asset of group) {
      const distance = loudnessOf(asset) - reference;
      if (Math.abs(distance) > toleranceLu) {
        warnings.push(
          `${asset.id}: integrated loudness ${loudnessOf(asset)} LUFS is ${round1(Math.abs(distance))} LU ${distance > 0 ? "above" : "below"} ${against} median (${round1(reference)} LUFS), past the ${toleranceLu} LU outlier limit; audition it, and re-prepare or retire it if the level is a mistake — section 10 forbids normalizing the collection`,
        );
      }
    }
  }

  return { errors: [], warnings, bands };
}

/**
 * Every library-wide audio audit, over every pack's assets at once — a role
 * band spans packs just as the section 6.5 balance does. This is what
 * `library:build`, `library:validate`, `library:audition` and `library:upload`
 * run, so a rule cannot gate one of them and not the others.
 *
 * @returns {{ errors: string[], warnings: string[], summary: string[] }}
 */
export function validateLibraryAudio(packManifests) {
  const assets = packManifests.flatMap((pm) => pm.assets).filter((asset) => asset.audio);
  const loudness = auditLoudness(assets);
  const duplicates = auditDuplicates(assets);
  const measured = assets.filter((asset) => Number.isFinite(asset.audio.loudnessLufs));
  const summary = [
    `loudness:            ${measured.length} assets measured (BS.1770-4), ${loudness.warnings.length} outside ±${LOUDNESS_OUTLIER_LU} LU of their role band (for review)`,
    formatTuningSummary(assets),
    `duplicates:          ${duplicates.exact.length} byte-identical pair(s) across packs, ${duplicates.near.length} near-duplicate pair(s) for review`,
  ];
  return {
    errors: [...loudness.errors, ...duplicates.errors],
    warnings: [...loudness.warnings, ...duplicates.warnings],
    summary,
  };
}

/**
 * One line on the tuning audit. The per-asset rule itself is in `validate.mjs`;
 * this says how much of the tonal library the detector could actually judge, so
 * "no tuning errors" is never read as "every root was checked".
 */
function formatTuningSummary(assets) {
  const tonal = assets.filter((asset) => asset.audio.tuningStatus);
  const count = (status) =>
    tonal.filter((asset) => asset.audio.tuningStatus === status).length;
  const detected = tonal.filter((asset) => asset.audio.tuningStatus === "detected");
  const beyond = detected.filter(
    (asset) => Math.abs(asset.audio.tuningCents) > TUNING_TOLERANCE_CENTS,
  ).length;
  const widest = Math.max(
    0,
    ...detected.map((asset) => Math.abs(asset.audio.tuningCents)),
  );
  return `tuning:              ${tonal.length} pitched assets, ${detected.length} detected (widest ±${widest} cents, ${beyond} beyond ±${TUNING_TOLERANCE_CENTS}), ${count("undetectable")} undetectable, ${count("gliding")} gliding`;
}

/** Mean absolute difference of two equal-length numeric arrays. */
function meanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * How far apart two assets' fingerprints are, or `null` when either has no
 * fingerprint to compare (no `peaks` or no `spectralSketch`). The per-asset
 * validator is what requires the sketch; this only compares what is there.
 */
export function fingerprintDistance(a, b) {
  const sketchA = a.audio?.spectralSketch;
  const sketchB = b.audio?.spectralSketch;
  if (!sketchA || !sketchB || sketchA.length !== sketchB.length) return null;
  if (!a.peaks || !b.peaks || a.peaks.length !== b.peaks.length) return null;
  return {
    durationRatio:
      Math.max(a.audio.durationSeconds, b.audio.durationSeconds) /
      Math.min(a.audio.durationSeconds, b.audio.durationSeconds),
    envelope: meanDistance(a.peaks, b.peaks) / 255,
    spectralDb: meanDistance(sketchA, sketchB) / SKETCH_STEPS_PER_DB,
  };
}

export function isNearDuplicate(distance, limits = NEAR_DUPLICATE) {
  return (
    distance !== null &&
    distance.durationRatio <= limits.maxDurationRatio &&
    distance.envelope <= limits.maxEnvelopeDistance &&
    distance.spectralDb <= limits.maxSpectralDistanceDb
  );
}

/**
 * Section 10: "Identify near duplicates using audio fingerprints and human
 * review." Two halves:
 *
 * - **Exact.** Byte-identical masters (same SHA-256). Inside one pack that is
 *   already an error (`validate.mjs`). Across packs it is how two packs share
 *   one stored object, so it is reported, not failed — but it is one sound,
 *   and section 17 counts unique assets.
 * - **Near.** Every pair whose envelope, spectrum and length all match within
 *   `NEAR_DUPLICATE`, within or across packs. Reported for a person to hear:
 *   a fingerprint cannot tell a lazy copy from two deliberately close
 *   variations, which is exactly the review section 10 asks for. A
 *   byte-identical pair is reported once, as exact.
 *
 * @returns {{ errors: string[], warnings: string[], exact: object[], near: object[] }}
 */
export function auditDuplicates(assets, { limits = NEAR_DUPLICATE } = {}) {
  const warnings = [];
  const exact = [];
  const near = [];

  const bySha = groupBy(
    assets.filter((asset) => asset.files?.master?.sha256),
    (asset) => asset.files.master.sha256,
  );
  // Every cross-pack pair in a group, not only each member against the first:
  // with copies in three packs, or two in one pack and a third elsewhere, every
  // pair that spans two packs is its own shared object to account for.
  for (const group of bySha.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]];
        if (a.pack?.id === b.pack?.id) continue; // validate.mjs fails it
        exact.push({ a: a.id, b: b.id });
        warnings.push(
          `${b.id}: byte-identical to ${a.id} in another pack; it is one sound, counted once`,
        );
      }
    }
  }

  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      const a = assets[i];
      const b = assets[j];
      if (a.files?.master?.sha256 && a.files.master.sha256 === b.files?.master?.sha256) {
        continue;
      }
      const distance = fingerprintDistance(a, b);
      if (!isNearDuplicate(distance, limits)) continue;
      near.push({ a: a.id, b: b.id, ...distance });
      warnings.push(
        `${a.id} and ${b.id} are near duplicates (envelope ${(distance.envelope * 100).toFixed(1)}% apart, spectrum ${distance.spectralDb.toFixed(2)} dB apart, lengths within ${((distance.durationRatio - 1) * 100).toFixed(0)}%); listen to both and keep one unless they are distinct on purpose`,
      );
    }
  }

  return { errors: [], warnings, exact, near };
}
