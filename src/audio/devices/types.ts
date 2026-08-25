import type * as Tone from "tone";
import type { Device } from "../../domain/entities";
import { bareParameterId, type ParameterDefinition } from "../../domain/parameters";
import type { AudioProjectScope } from "../AudioRuntime";

/**
 * Continuous device parameter edits ramp over this window rather than stepping,
 * so a cutoff sweep, a drive push, or a wet/dry move never clicks (FX-01:
 * parameter changes "are smoothed where necessary"). Matched to the instrument
 * layer's `SMOOTHING_SECONDS` so the two feel identical under the hand.
 */
export const DEVICE_SMOOTHING_SECONDS = 0.02;

/**
 * What a device node needs from the graph that owns it. A device gets its
 * owning scope so anything it constructs is registered for disposal (PRD
 * AUD-09), and a tempo reader so a tempo-syncable device can resolve a musical
 * division to seconds without importing the transport or the song.
 */
export interface DeviceGraphContext {
  readonly scope: AudioProjectScope;
  /** The song's current tempo in BPM, read at each `update()`. */
  readonly tempo: () => number;
}

/**
 * The DSP core of one device type: the processing itself, with no wet/dry,
 * output trim, or bypass handling. {@link buildDeviceNode} wraps a core in the
 * shared mix stage every device shares, so a device implementation is only ever
 * as long as its own signal path.
 *
 * `apply()` receives the device's fully-defaulted parameter values (see
 * {@link readDeviceParameters}) and must apply them to the *existing* nodes —
 * never by constructing a replacement. Continuous values go through
 * {@link setOrRamp}, which handles the initial-versus-edit distinction that
 * `initial` carries.
 */
export interface DeviceCore {
  readonly input: Tone.ToneAudioNode;
  readonly output: Tone.ToneAudioNode;
  apply(
    values: DeviceParameterValues,
    context: DeviceGraphContext,
    initial: boolean,
  ): void;
  dispose(): void;
  /**
   * An optional live read of how much gain the device is currently removing,
   * in dB (0 when it is not reducing). Only the compressor implements it; the
   * panel polls it for a gain-reduction meter (FX-01) and it is never the
   * source of an analytics event.
   */
  gainReductionDb?(): number;
  /**
   * The delay time this device last resolved to, in seconds. Only the delay
   * implements it. A panel reads it to show the time a *synced* delay currently
   * works out to, which the stored parameters alone do not say — the answer
   * depends on the song tempo. Reading the live `delayTime` param instead would
   * report the wrong value mid-edit, since a parameter change is ramped rather
   * than stepped.
   */
  resolvedDelaySeconds?(): number;
  /**
   * Resolves once any asynchronously-built resource the device needs is in
   * place. Only the reverb implements it, because its impulse response is
   * generated off the audio thread. Live playback never awaits it — the node
   * simply keeps its previous impulse until the new one lands, so a decay edit
   * mid-tail does not drop to silence — but an *offline* render must, since a
   * render that starts before the impulse exists produces no tail at all.
   */
  ready?(): Promise<void>;
}

/** A device's parameter values, by bare id, with every default filled in. */
export type DeviceParameterValues = Readonly<Record<string, number>>;

/**
 * Reads a device's stored parameters against its registered definitions,
 * substituting each definition's default for a key the sparse map omits. Every
 * device core reads its values through this, so a device persisted before a
 * parameter existed still resolves to a complete, in-range set rather than
 * `undefined` reaching a Web Audio param.
 */
export function readDeviceParameters(
  definitions: readonly ParameterDefinition[],
  device: Device,
): DeviceParameterValues {
  const values: Record<string, number> = {};
  for (const definition of definitions) {
    const key = bareParameterId(definition.id);
    const stored = device.parameters[key];
    values[key] = Number.isFinite(stored) ? stored : definition.defaultValue;
  }
  return values;
}

/** Builds the DSP core for a device type. */
export type DeviceCoreFactory = (
  device: Device,
  context: DeviceGraphContext,
) => DeviceCore;

/** The slice of a Tone/Web Audio param {@link setOrRamp} needs. */
export interface RampableParam {
  linearRampTo(value: number, rampTime: number): unknown;
  setValueAtTime(value: number, time: number): unknown;
}

/**
 * Applies one continuous parameter: set outright the first time, ramped on
 * every edit after (PRD FX-01 smoothing).
 *
 * The distinction is not cosmetic. A ramp is *scheduled* against the audio
 * context's clock — a future automation curve, not a value — so in an offline
 * render, whose clock has not advanced when the graph is built, a ramp can land
 * after the render has finished and leave the node at its construction default
 * throughout. That made two renders with different settings come out
 * byte-identical: a test passing by accident, and a ~1-in-10 flake across these
 * suites. `setValueAtTime(value, 0)` is unambiguous in both worlds.
 */
export function setOrRamp(param: RampableParam, value: number, initial: boolean): void {
  if (initial) param.setValueAtTime(value, 0);
  else param.linearRampTo(value, DEVICE_SMOOTHING_SECONDS);
}
