import * as Tone from "tone";
import { disposeFinishedVoice } from "./instruments/assetVoice";
import { SummingBus } from "./summingBus";

/**
 * The two private fields `Tone.GrainPlayer` keeps its grains in, read here so
 * each grain can go through a {@link SummingBus}. The tests pin them, so a Tone
 * upgrade that renames them fails there rather than silently.
 */
interface GrainPlayerInternals {
  _clock: Tone.Clock;
  _activeSources: Tone.ToneBufferSource[];
}

function grainInternals(player: Tone.GrainPlayer): GrainPlayerInternals {
  const internals = player as unknown as Partial<GrainPlayerInternals>;
  if (
    !(internals._clock instanceof Tone.Clock) ||
    !Array.isArray(internals._activeSources)
  ) {
    throw new Error("Tone.GrainPlayer no longer exposes its grain clock");
  }
  return internals as GrainPlayerInternals;
}

/**
 * A `Tone.GrainPlayer` whose overlapping grains sum in one fixed order (#867).
 *
 * Tone connects every grain straight to the player's output, and a grain's
 * crossfade tail overlaps the next ones, so its output sums several grains at
 * once. Blink sums those in an order that changes between renders (see
 * `summingBus.ts`), so a stretched loop exported twice came out different. The
 * grain clock here is Tone's own, and each grain is built exactly as
 * `GrainPlayer._tick` builds it. The only change is where a grain connects: to
 * its own stage of a summing bus, released once the grain has finished
 * sounding.
 */
export class OrderedGrainPlayer extends Tone.GrainPlayer {
  private readonly grains: SummingBus;

  constructor(buffer: Tone.ToneAudioBuffer) {
    super(buffer);
    this.grains = new SummingBus(this.context);
    this.grains.output.connect(this.output);
    grainInternals(this)._clock.callback = (time) => this.tickGrain(time);
  }

  /** `GrainPlayer._tick`, connecting the grain to the bus. */
  private tickGrain(time: number): void {
    const { _clock: clock, _activeSources: active } = grainInternals(this);
    // Tone stores both in seconds; only the setters' types are wider.
    const grainSize = this.toSeconds(this.grainSize);
    const overlap = this.toSeconds(this.overlap);
    const ticks = clock.getTicksAtTime(time);
    const offset = ticks * grainSize;
    if (!this.loop && offset > this.buffer.duration) {
      this.stop(time);
      return;
    }
    const fadeIn = offset < overlap ? 0 : overlap;
    const source = new Tone.ToneBufferSource({
      context: this.context,
      url: this.buffer,
      fadeIn,
      fadeOut: overlap,
      loop: this.loop,
      loopStart: this.loopStart,
      loopEnd: this.loopEnd,
      playbackRate: Tone.intervalToFrequencyRatio(this.detune / 100),
    });
    const detach = this.grains.add(source);
    source.start(time, grainSize * ticks);
    source.stop(time + grainSize / this.playbackRate);
    active.push(source);
    source.onended = () => {
      const index = active.indexOf(source);
      if (index !== -1) active.splice(index, 1);
      disposeFinishedVoice(source, detach);
    };
  }

  dispose(): this {
    super.dispose();
    this.grains.dispose();
    return this;
  }
}
