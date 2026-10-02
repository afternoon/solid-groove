/**
 * The automatic makeup gain a `DynamicsCompressorNode` applies on its own, in
 * dB, for a given threshold, knee and ratio (#884).
 *
 * The Web Audio spec has the node lift its whole output by
 * `(1 / curve(1.0)) ^ 0.6`: the static compression curve evaluated at a 0 dBFS
 * input, inverted, and softened by an "empirical" 0.6 power. Nothing turns it
 * off, so without cancelling it a compressor at 0 dB makeup gets *louder* as
 * the ratio rises. The compressor core subtracts this figure from its makeup
 * stage so the producer's Makeup is the only gain the device adds.
 *
 * The spec leaves the knee's shape to the implementation, and for any setting
 * whose knee ends below 0 dBFS the figure depends on it, so this mirrors the
 * kernel Chromium, Firefox and WebKit all share (WebKit's
 * `DynamicsCompressorKernel`): an exponential knee whose sharpness `k` is
 * solved by bisection so its slope at the knee's end meets `1 / ratio`. It is
 * reproduced step for step — the same 15 iterations, the same 0.1% slope probe
 * — because a figure that only approximates the node's would leave a residual
 * gain behind.
 *
 * Pure arithmetic with no Web Audio import, so it is unit-testable on its own.
 */
export function builtInMakeupGainDb(
  thresholdDb: number,
  kneeDb: number,
  ratio: number,
): number {
  const curve = staticCurve(thresholdDb, kneeDb, ratio);
  return -0.6 * linearToDecibels(curve(1));
}

function decibelsToLinear(db: number): number {
  return 10 ** (0.05 * db);
}

/** The kernel's guard: silence reads as -1000 dB, not `-Infinity`. */
function linearToDecibels(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -1000;
}

/** The node's static input -> output curve, in linear amplitude. */
function staticCurve(
  thresholdDb: number,
  kneeDb: number,
  ratio: number,
): (x: number) => number {
  const linearThreshold = decibelsToLinear(thresholdDb);

  const kneeCurve = (x: number, k: number): number =>
    x < linearThreshold
      ? x
      : linearThreshold + (1 - Math.exp(-k * (x - linearThreshold))) / k;

  const slopeAt = (x: number, k: number): number => {
    if (x < linearThreshold) return 1;
    const x2 = x * 1.001;
    const xDb = linearToDecibels(x);
    const x2Db = linearToDecibels(x2);
    const yDb = linearToDecibels(kneeCurve(x, k));
    const y2Db = linearToDecibels(kneeCurve(x2, k));
    return (y2Db - yDb) / (x2Db - xDb);
  };

  const slope = 1 / ratio;
  const kneeThresholdDb = thresholdDb + kneeDb;
  const kneeThreshold = decibelsToLinear(kneeThresholdDb);

  // Bisect (geometrically) for the knee sharpness whose slope at the knee's
  // end is the ratio's.
  let minK = 0.1;
  let maxK = 10000;
  let k = 5;
  for (let i = 0; i < 15; i++) {
    if (slopeAt(kneeThreshold, k) < slope) maxK = k;
    else minK = k;
    k = Math.sqrt(minK * maxK);
  }

  const yKneeThresholdDb = linearToDecibels(kneeCurve(kneeThreshold, k));

  return (x) => {
    if (x < kneeThreshold) return kneeCurve(x, k);
    // A constant ratio above the knee.
    const yDb = yKneeThresholdDb + slope * (linearToDecibels(x) - kneeThresholdDb);
    return decibelsToLinear(yDb);
  };
}
