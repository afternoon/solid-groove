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
  const measured = assets.filter((asset) => Number.isFinite(asset.audio.loudnessLufs));
  const summary = [
    `loudness:            ${measured.length} assets measured (BS.1770-4), ${loudness.warnings.length} outside ±${LOUDNESS_OUTLIER_LU} LU of their role band (for review)`,
    formatTuningSummary(assets),
  ];
  return {
    errors: [...loudness.errors],
    warnings: [...loudness.warnings],
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
