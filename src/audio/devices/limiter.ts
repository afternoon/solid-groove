import * as Tone from "tone";
import { type DeclaredLatency, dynamicsLookaheadFrames } from "../latency";
import { applyDynamicsParam } from "./compressor";
import { builtInMakeupGainDb } from "./compressorMakeup";
import { type DeviceCore, type DeviceCoreFactory, setOrRamp } from "./types";

/**
 * The ratio the limiting stage runs at: as steep as `DynamicsCompressorNode`
 * goes, so above the ceiling it is a limiter rather than a compressor.
 */
const LIMIT_RATIO = 20;

/** No knee: a limiter acts at its ceiling, not on the way up to it. */
const LIMIT_KNEE_DB = 0;

/** As fast as the node reacts; its lookahead is what lets that catch a peak. */
const LIMIT_ATTACK_SECONDS = 0;

/**
 * How far the Limiter delays its signal: the one `DynamicsCompressorNode`
 * lookahead it runs through, aligned on the dry leg as the Compressor's is, so
 * neither a setting nor a bypass ever moves the song in time (#883, #937).
 */
export const limiterLatencyFrames: DeclaredLatency = dynamicsLookaheadFrames;

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/**
 * Limiter: drive, ceiling and release, with a live gain-reduction read and
 * a loudness meter on its output for the panel (#937).
 *
 * `drive -> limit -> toUnit -> clip -> fromUnit`:
 *
 * - `drive` is a clean gain stage that pushes the source into the ceiling.
 * - `limit` is a `DynamicsCompressorNode` at 20:1 with no knee and the fastest
 *   attack, its threshold at the ceiling. Its lookahead lets it pull a peak
 *   down before the peak leaves, which is what does almost all of the work.
 * - Even 20:1 lets a little through, and an attack still overshoots, so the
 *   last stage is a hard clip at the ceiling. That is what makes the ceiling a
 *   promise rather than a target: no sample leaves above it. The clip is a
 *   fixed `[-1, 1]` waveshaper — Web Audio holds a shaper's output at its
 *   curve's ends for anything past them — between two gains that scale the
 *   ceiling to full scale and back, so a ceiling edit ramps two gains rather
 *   than rebuilding a curve, and never clicks.
 *
 * `toUnit` also cancels the automatic makeup gain the node adds on its own
 * (#884), so the Limiter only ever lowers what is over the ceiling and Drive is
 * the only gain it adds.
 *
 * Bypass and its alignment come from the shared mix stage: a Limiter has no
 * Dry/Wet, but its dry leg still carries the signal when bypassed, through a
 * unity copy of the node so it arrives on the same frame (`dryAlign`).
 */
export const createLimiterCore: DeviceCoreFactory = (): DeviceCore => {
  const drive = new Tone.Gain(1);
  const limit = new Tone.Compressor();
  const toUnit = new Tone.Gain(1);
  const clip = new Tone.WaveShaper([-1, 1]);
  const fromUnit = new Tone.Gain(1);
  drive.chain(limit, toUnit, clip, fromUnit);

  const dryAlign = new Tone.Compressor();
  applyDynamicsParam(dryAlign.knee, 0, true);
  applyDynamicsParam(dryAlign.threshold, 0, true);
  applyDynamicsParam(dryAlign.ratio, 1, true);

  return {
    input: drive,
    output: fromUnit,
    dryAlign,
    loudness: true,
    apply(values, _context, initial) {
      setOrRamp(drive.gain, dbToGain(values.drive), initial);
      const knee = applyDynamicsParam(limit.knee, LIMIT_KNEE_DB, initial);
      const ratio = applyDynamicsParam(limit.ratio, LIMIT_RATIO, initial);
      const threshold = applyDynamicsParam(limit.threshold, values.ceiling, initial);
      applyDynamicsParam(limit.attack, LIMIT_ATTACK_SECONDS, initial);
      applyDynamicsParam(limit.release, values.release, initial);
      const ceiling = dbToGain(values.ceiling);
      const makeup = builtInMakeupGainDb(threshold, knee, ratio);
      setOrRamp(toUnit.gain, dbToGain(-makeup) / ceiling, initial);
      setOrRamp(fromUnit.gain, ceiling, initial);
    },
    /** How far the limiting stage is pulling the signal down, as a positive dB. */
    gainReductionDb() {
      return Math.abs(limit.reduction);
    },
    dispose() {
      drive.dispose();
      limit.dispose();
      toUnit.dispose();
      clip.dispose();
      fromUnit.dispose();
      dryAlign.dispose();
    },
  };
};
