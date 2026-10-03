import * as Tone from "tone";

/**
 * How long a change of compensation glides over (#883). Adding or removing a
 * lookahead device moves every other path's compensation by its latency (a
 * few milliseconds); jumping a delay line's read position would click, so the
 * delay time ramps instead. Over 50 ms a 6 ms change is a slight, brief pitch
 * bend on the paths it moves, and no discontinuity at all.
 */
export const COMPENSATION_RAMP_SECONDS = 0.05;

/**
 * The longest compensation a path can take: roughly eighty compressors
 * in one chain. A delay line allocates its whole buffer up front, and there
 * are a few per track, so this is kept to what a song could plausibly need.
 */
export const MAX_COMPENSATION_SECONDS = 0.5;

/**
 * One path's plugin delay compensation: a delay line held at a whole number of
 * frames (see `latencyCompensation.ts`). It is always in the path, at 0 when
 * the path needs no compensation, so a device added anywhere re-aligns the
 * other paths by moving a parameter, never by rebuilding or reconnecting them.
 */
export class CompensationDelay {
  readonly node: Tone.Delay;
  private frames: number | null = null;

  constructor() {
    this.node = new Tone.Delay({ delayTime: 0, maxDelay: MAX_COMPENSATION_SECONDS });
  }

  /** The frames this path is currently compensated by. */
  get compensationFrames(): number {
    return this.frames ?? 0;
  }

  /**
   * Holds the path back by `frames`. The first value is set outright (an
   * offline render's clock has not advanced, so a ramp would land late);
   * every change after glides over {@link COMPENSATION_RAMP_SECONDS}.
   */
  set(frames: number): void {
    if (frames === this.frames) return;
    const seconds = Math.min(
      MAX_COMPENSATION_SECONDS,
      frames / this.node.context.sampleRate,
    );
    const delayTime = this.node.delayTime;
    if (this.frames === null) {
      delayTime.setValueAtTime(seconds, 0);
    } else {
      delayTime.linearRampTo(seconds, COMPENSATION_RAMP_SECONDS);
    }
    this.frames = frames;
  }

  dispose(): void {
    this.node.dispose();
  }
}
