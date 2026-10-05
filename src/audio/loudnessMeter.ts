import * as Tone from "tone";
import { kWeighting, LoudnessAccumulator, type LoudnessReading } from "./loudness";

/**
 * How much audio the meter can look back over at one read: 8192 frames, about
 * 170 ms at 48 kHz, so a read once per animation frame — or a frame dropped
 * now and then — never misses any.
 */
const WINDOW_FRAMES = 8_192;

/**
 * A gap between reads longer than this means playback stopped and started
 * again, not that audio went unmeasured: the next read starts afresh.
 */
const MAX_GAP_SECONDS = 0.5;

/**
 * Measures the loudness of `source` in LUFS (#937): K-weighted by two
 * IIR stages and read by a two-channel waveform analyser, then accumulated
 * by {@link LoudnessAccumulator}.
 *
 * It is a tap, never an insert: `source` fans out to it, so it cannot colour
 * the signal. It does not run on a clock of its own. Each {@link sample} takes
 * whatever audio passed since the last one, by the audio clock, so the
 * editor's frame loop, which already polls the meters while the transport
 * plays, is what drives it.
 */
export class LoudnessMeter {
  private readonly shelf: IIRFilterNode;
  private readonly highPass: IIRFilterNode;
  private readonly analyser: Tone.Analyser;
  private readonly accumulator = new LoudnessAccumulator();
  private readonly sampleRate: number;
  private lastTime: number | null = null;

  constructor(private readonly source: Tone.ToneAudioNode) {
    const context = source.context;
    this.sampleRate = context.sampleRate;
    const [shelf, highPass] = kWeighting(this.sampleRate);
    this.shelf = context.createIIRFilter([...shelf.b], [...shelf.a]);
    this.highPass = context.createIIRFilter([...highPass.b], [...highPass.a]);
    this.analyser = new Tone.Analyser({
      context,
      type: "waveform",
      size: WINDOW_FRAMES,
      channels: 2,
    });
    Tone.connect(source, this.shelf);
    this.shelf.connect(this.highPass);
    Tone.connect(this.highPass, this.analyser);
  }

  /** Takes in the audio since the last call and returns the reading. */
  sample(): LoudnessReading {
    const now = this.source.context.currentTime;
    const elapsed = this.lastTime === null ? 0 : now - this.lastTime;
    this.lastTime = now;
    if (elapsed > 0 && elapsed <= MAX_GAP_SECONDS) {
      const frames = Math.min(WINDOW_FRAMES, Math.round(elapsed * this.sampleRate));
      const channels = this.analyser.getValue() as Float32Array[];
      let power = 0;
      for (const samples of channels) {
        let sum = 0;
        for (let i = samples.length - frames; i < samples.length; i += 1) {
          sum += samples[i] * samples[i];
        }
        power += sum / frames;
      }
      this.accumulator.push(power, frames / this.sampleRate);
    }
    return this.accumulator.reading();
  }

  /** Starts the programme over: playback has started again from the top. */
  reset(): void {
    this.accumulator.reset();
    this.lastTime = null;
  }

  dispose(): void {
    Tone.disconnect(this.source, this.shelf);
    this.shelf.disconnect();
    this.highPass.disconnect();
    this.analyser.dispose();
  }
}
