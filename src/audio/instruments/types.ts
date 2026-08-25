import type * as Tone from "tone";
import type { Instrument, NoteTrigger } from "../../domain/entities";
import type { AssetId } from "../../domain/ids";
import type { AudioAssetProjection } from "../../projection/audioProjection";
import type { AudioBufferCache } from "../AudioBufferCache";
import type { AudioProjectScope } from "../AudioRuntime";

/** Continuous parameter edits ramp over this window rather than stepping, so a
 * cutoff sweep or a filter-Q change never clicks (AUD "safe smoothing"). */
export const SMOOTHING_SECONDS = 0.02;

/** Schema v1 models `Instrument` as one discriminated union rather than
 * exporting each variant separately; these local aliases narrow it by `kind`
 * for the factory below. */
export type SamplerInstrument = Extract<Instrument, { kind: "sampler" }>;
export type SynthInstrument = Extract<Instrument, { kind: "synth" }>;
export type DrumMachineInstrument = Extract<Instrument, { kind: "drumMachine" }>;

/**
 * A track's sound source, keyed to the track by the track graph that owns it
 * (PRD AUD-08, section 9.7). `update()` applies an instrument of the *same*
 * `kind` in place — asset swaps, drum-pad add/remove, and generic parameter
 * edits are all handled without replacing this node. The owning
 * `TrackAudioGraph` only ever replaces the whole node when `kind` itself
 * changes (sampler <-> synth <-> drumMachine, or null <-> present).
 */
export interface InstrumentNode {
  readonly kind: Instrument["kind"];
  readonly output: Tone.ToneAudioNode;
  trigger(
    trigger: NoteTrigger,
    time: Tone.Unit.Time,
    duration: Tone.Unit.Time,
    velocity: number,
  ): void;
  update(instrument: Instrument): void;
  dispose(): void;
}

export interface InstrumentGraphContext {
  readonly scope: AudioProjectScope;
  readonly assetsById: ReadonlyMap<AssetId, AudioAssetProjection>;
  readonly bufferCache: AudioBufferCache<Tone.ToneAudioBuffer>;
}

export type InstrumentNodeFactory = (
  instrument: Instrument,
  context: InstrumentGraphContext,
) => InstrumentNode;
