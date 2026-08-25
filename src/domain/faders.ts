import { clampParameterValue, type ParameterDefinition, TRACK_PAN } from "./parameters";

/**
 * The perceptual mapping between a volume fader's screen position and the
 * decibel value it stores (PRD `TRK-02`: "Faders use a perceptually useful
 * curve and show a human-readable value").
 *
 * A linear dB-to-position mapping wastes most of a fader's travel on inaudible
 * changes near the bottom and crams every useful move into the top few pixels.
 * Real consoles taper the scale so the region around unity (0 dB) — where a
 * mixer spends almost all of their time — gets the most resolution, and the
 * long quiet tail down to the floor is compressed. This module implements one
 * such taper as a pure, reversible function of a parameter definition's own
 * range, so the same curve serves track volume, return volume, and the master
 * fader without any of them repeating a literal.
 *
 * The curve is piecewise: the top segment (from `UNITY_POSITION` to the top of
 * travel) spans the definition's above-unity headroom linearly, and the bottom
 * segment applies an exponential taper across the attenuation range so equal
 * pixel moves feel like roughly equal loudness changes. Position is always a
 * normalized `0..1` — `0` is the floor (the definition's minimum), `1` is the
 * top of travel (its maximum) — which keeps the UI slider unit-agnostic.
 */

/** Where unity gain (0 dB) sits on the fader, as a fraction of total travel. */
export const UNITY_POSITION = 0.75;

/** Steepness of the exponential taper below unity. Higher = more resolution near unity. */
const TAPER = 3;

/**
 * The decibel value one fader position stores, folded into the definition's
 * range. Position is clamped to `0..1` first, so a stray value can never map
 * outside the fader.
 */
export function faderPositionToDb(
  definition: ParameterDefinition,
  position: number,
): number {
  const clamped = clamp01(position);
  const unity = unityDb(definition);
  if (clamped >= UNITY_POSITION) {
    const above = (clamped - UNITY_POSITION) / (1 - UNITY_POSITION);
    return clampParameterValue(definition, unity + above * (definition.max - unity));
  }
  const below = clamped / UNITY_POSITION;
  // exp taper: at below=1 → unity, at below=0 → definition.min.
  const tapered = (Math.exp(TAPER * below) - 1) / (Math.exp(TAPER) - 1);
  return clampParameterValue(
    definition,
    definition.min + tapered * (unity - definition.min),
  );
}

/** The fader position that shows a given decibel value. Inverse of {@link faderPositionToDb}. */
export function dbToFaderPosition(definition: ParameterDefinition, db: number): number {
  const value = clampParameterValue(definition, db);
  const unity = unityDb(definition);
  if (value >= unity) {
    const above =
      definition.max === unity ? 0 : (value - unity) / (definition.max - unity);
    return UNITY_POSITION + above * (1 - UNITY_POSITION);
  }
  const tapered = (value - definition.min) / (unity - definition.min);
  const below = Math.log(tapered * (Math.exp(TAPER) - 1) + 1) / TAPER;
  return clamp01(below * UNITY_POSITION);
}

/**
 * A human-readable dB value for a fader tooltip or readout. The floor of the
 * range reads as "-∞" (silence), and unity is shown with an explicit sign so a
 * musician can nudge back to exactly 0 dB.
 */
export function formatDb(definition: ParameterDefinition, db: number): string {
  const value = clampParameterValue(definition, db);
  if (value <= definition.min) return "-∞ dB";
  const rounded = Number(value.toFixed(1));
  if (rounded === 0) return "0.0 dB";
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)} dB`;
}

/**
 * A human-readable pan value: centre, or a left/right percentage. `TRACK_PAN`
 * is bipolar `-1..1`, so this reports "L100"/"C"/"R100" the way a channel strip
 * does rather than a bare signed number.
 */
export function formatPan(pan: number): string {
  const value = clampParameterValue(TRACK_PAN, pan);
  const percent = Math.round(Math.abs(value) * 100);
  if (percent === 0) return "C";
  return value < 0 ? `L${percent}` : `R${percent}`;
}

function unityDb(definition: ParameterDefinition): number {
  // Unity is 0 dB when the range straddles it (every volume parameter does);
  // otherwise it degrades to the range's own default so the curve stays valid.
  return definition.min <= 0 && definition.max >= 0 ? 0 : definition.defaultValue;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
