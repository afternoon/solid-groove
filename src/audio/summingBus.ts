import * as Tone from "tone";

/**
 * Sums any number of sources two at a time, in the order they were added, so
 * the same sources always sum to the same samples (#867).
 *
 * Web Audio sums every connection into one input, and Blink keeps those
 * connections in a hash set keyed by address. Its summing order therefore
 * changes from one render to the next. Float addition is not associative, so
 * three or more sounding inputs on one node come out a rounding error
 * different each time. Two inputs do not, because `a + b` is exactly `b + a`.
 * Dynamics and saturation downstream then turn that rounding error into
 * different 24-bit samples, and two exports of an unchanged song differ.
 *
 * So a bus gives every source its own unity-gain stage and chains the stages:
 * stage `n` hears stage `n - 1` and source `n`, and nothing else. No node has
 * more than two inputs, and the sum is computed in one fixed order. A source
 * removed from the middle relinks its neighbours, so the order of the rest is
 * unchanged.
 *
 * Use one wherever more than two sources can sound into a node at once: voices
 * into an instrument, tracks and returns into the master, sends into a return.
 */
export class SummingBus {
  /** Where the sum comes out. */
  readonly output: Tone.Gain;
  private readonly stages: Tone.Gain[] = [];
  private disposed = false;

  /** `context` is the one every stage is built on, the global one by default. */
  constructor(context: Tone.BaseContext = Tone.getContext()) {
    this.output = new Tone.Gain({ context, gain: 1 });
  }

  /** How many sources the bus sums now. */
  get size(): number {
    return this.stages.length;
  }

  /**
   * Adds `source` to the end of the sum. Returns a detach that takes it out
   * again; it is idempotent and safe after `source` itself is disposed.
   */
  add(source: Tone.ToneAudioNode): () => void {
    const stage = new Tone.Gain({ context: this.output.context, gain: 1 });
    const last = this.stages.at(-1);
    if (last) {
      last.disconnect(this.output);
      last.connect(stage);
    }
    stage.connect(this.output);
    source.connect(stage);
    this.stages.push(stage);

    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      if (!source.disposed) source.disconnect(stage);
      this.remove(stage);
    };
  }

  private remove(stage: Tone.Gain): void {
    if (this.disposed) return;
    const index = this.stages.indexOf(stage);
    if (index < 0) return;
    const previous = this.stages[index - 1];
    const next = this.stages[index + 1] ?? this.output;
    if (previous) {
      previous.disconnect(stage);
      previous.connect(next);
    }
    this.stages.splice(index, 1);
    stage.dispose();
  }

  /** Disposes every stage and the output. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const stage of this.stages) stage.dispose();
    this.stages.length = 0;
    this.output.dispose();
  }
}
