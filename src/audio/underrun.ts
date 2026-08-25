import { type BucketLabel, bucketOf } from "../analytics/buckets";
import { type SampleRateKey, sampleRateKey } from "../analytics/catalog";

/**
 * Sampled scheduling-underrun detection (PRD AUD-03/OPS-02).
 *
 * The engine schedules every note and loop *ahead* of its audible time (see
 * `ProjectAudioGraph`), so when a scheduled callback runs, the intended audio
 * time is normally still in the future. If the audio clock has already passed
 * that intended time, the event is late — a scheduling underrun. This monitor
 * observes each fired event's (intended, actual) pair, counts the late ones,
 * and reports them *sampled* rather than one event per drop, so playback never
 * emits per-scheduled-event telemetry (PRD OPS-02: "No event fires per note,
 * per animation frame ... high-frequency signals are ... sampled with the
 * sampling rate recorded").
 *
 * It is a pure counter with an injected emit callback: it never imports the
 * analytics boundary, so its sampling logic is testable without a transport.
 */

/** How late (in seconds) an event may be before it counts as an underrun. A
 * small tolerance absorbs ordinary clock jitter without masking real drops. */
export const UNDERRUN_TOLERANCE_SECONDS = 0.02;

/**
 * The share of the audio second rate we treat as the reporting sampling rate.
 * `audio_underrun` records this so a report can scale a sampled count back up
 * (PRD OPS-02). One report is emitted per `1 / SAMPLING_RATE` detected drops.
 */
export const UNDERRUN_SAMPLING_RATE = 0.1;

export interface UnderrunReport {
  readonly droppedEventBucket: BucketLabel<"dropped_events">;
  readonly sampleRate: SampleRateKey;
}

export interface UnderrunMonitorOptions {
  /** The audio context sample rate, recorded on every report. */
  readonly contextSampleRate: number;
  /** Fired once per sampling window with the bucketed drop count. */
  readonly emit: (report: UnderrunReport) => void;
  /** Fraction of detected drops that produce a report. Defaults to {@link UNDERRUN_SAMPLING_RATE}. */
  readonly samplingRate?: number;
  /** Lateness tolerance in seconds. Defaults to {@link UNDERRUN_TOLERANCE_SECONDS}. */
  readonly toleranceSeconds?: number;
}

/**
 * Counts late scheduled events and emits a sampled `audio_underrun`-shaped
 * report. `observe(intended, actual)` is called from every scheduled callback;
 * only a fraction of accumulated drops produce a report, and the report carries
 * the bucketed count in that window plus the recorded sample rate.
 */
export class UnderrunMonitor {
  private readonly sampleRate: SampleRateKey;
  private readonly emit: (report: UnderrunReport) => void;
  private readonly samplingRate: number;
  private readonly tolerance: number;
  /** Drops accumulated toward the next report threshold. */
  private windowDrops = 0;
  /** The number of drops that triggers one report (1 / samplingRate). */
  private readonly reportEvery: number;

  constructor(options: UnderrunMonitorOptions) {
    this.sampleRate = sampleRateKey(options.contextSampleRate);
    this.emit = options.emit;
    this.samplingRate = options.samplingRate ?? UNDERRUN_SAMPLING_RATE;
    this.tolerance = options.toleranceSeconds ?? UNDERRUN_TOLERANCE_SECONDS;
    this.reportEvery = Math.max(1, Math.round(1 / this.samplingRate));
  }

  /**
   * Observe one fired scheduled event. `intendedTime` is the audio time it was
   * scheduled for; `actualTime` is the audio clock when the callback ran. A
   * callback that runs on time (actual <= intended + tolerance) is not a drop.
   */
  observe(intendedTime: number, actualTime: number): void {
    if (actualTime <= intendedTime + this.tolerance) return;
    this.windowDrops += 1;
    if (this.windowDrops < this.reportEvery) return;
    const dropped = this.windowDrops;
    this.windowDrops = 0;
    this.emit({
      droppedEventBucket: bucketOf("dropped_events", dropped),
      sampleRate: this.sampleRate,
    });
  }
}
