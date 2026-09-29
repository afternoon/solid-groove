import * as Tone from "tone";
import { type Scheduler, timeoutScheduler } from "../shared/scheduler";

/**
 * The piece of an offline render that has to run *inside* Tone's JavaScript
 * clock rather than on the audio thread: firing transport events, and the
 * nodes those events build.
 *
 * Why this exists instead of `Tone.Offline()`: every short-lived voice the
 * instruments build (a sampler note, a drum hit, a loop player) is constructed
 * inside a transport callback with `new Tone.Player(...)`, which binds to
 * whatever `Tone.getContext()` returns *at that moment*. `Tone.Offline()` puts
 * the global context back as soon as rendering has *started*, and its clock
 * then fires those callbacks later, against the live context — so a scheduled
 * note builds its player in the wrong context and never reaches the render.
 *
 * Leaving the global context pointed at the offline one for the whole render
 * would be worse: the live transport keeps ticking while an export runs, and
 * its callbacks would build *their* voices in the offline graph, silencing
 * live playback (EXP-001: an export "cannot mutate live playback"). So the
 * global context is swapped only for spans of **synchronous** work, where no
 * live callback can possibly run in between, and restored before every yield.
 */
export function withGlobalContext<T>(context: Tone.BaseContext, work: () => T): T {
  const previous = Tone.getContext();
  Tone.setContext(context);
  try {
    const result = work();
    if (result instanceof Promise) {
      // The swap cannot be held across an await, so async work here is a bug.
      throw new Error("withGlobalContext: work must be synchronous");
    }
    return result;
  } finally {
    Tone.setContext(previous);
  }
}

/**
 * The two fields of `Tone.OfflineContext` its own `_renderClock` loop drives.
 * Tone keeps them private, and advancing the clock in chunks — so the swap
 * above never spans a yield — means stepping them here. `offlineClock.test.ts`
 * pins the behaviour against Tone's public `currentTime`, so a Tone upgrade
 * that renames them fails there rather than rendering silence.
 */
interface OfflineClockInternals {
  _currentTime: number;
  _duration: number;
}

function clockInternals(context: Tone.OfflineContext): OfflineClockInternals {
  const internals = context as unknown as Partial<OfflineClockInternals>;
  if (
    typeof internals._currentTime !== "number" ||
    typeof internals._duration !== "number"
  ) {
    throw new Error("Tone.OfflineContext no longer exposes its offline clock");
  }
  return internals as OfflineClockInternals;
}

/**
 * Advances the offline clock, one 128-frame block per tick exactly as Tone's
 * own `_renderClock` does, until it passes `untilSeconds` or the render's end.
 * Returns whether the clock has reached the end of the render.
 *
 * Every tick runs with the offline context installed globally, so anything a
 * transport callback constructs is built in the offline graph.
 */
export function advanceOfflineClock(
  context: Tone.OfflineContext,
  untilSeconds: number,
): boolean {
  const clock = clockInternals(context);
  const blockSeconds = 128 / context.sampleRate;
  withGlobalContext(context, () => {
    while (
      clock._duration - clock._currentTime >= 0 &&
      clock._currentTime <= untilSeconds
    ) {
      context.emit("tick");
      clock._currentTime += blockSeconds;
    }
  });
  return clock._duration - clock._currentTime < 0;
}

export interface RunOfflineClockOptions {
  /** How much audio time one synchronous chunk covers before yielding. */
  chunkSeconds?: number;
  /** Where the yields between chunks are scheduled; injectable for tests. */
  scheduler?: Scheduler;
  /** Checked before every chunk; returning true stops the clock early. */
  shouldStop?: () => boolean;
  /** The fraction of the render's clock that has run, after every chunk. */
  onProgress?: (fraction: number) => void;
  /** Awaited after every chunk but the last, before the yield. */
  afterChunk?: (untilSeconds: number) => Promise<void>;
}

/** Five seconds of audio per chunk keeps each synchronous span short while
 * keeping the number of yields — each at least one event-loop turn — small. */
export const DEFAULT_CLOCK_CHUNK_SECONDS = 5;

/**
 * Runs the offline clock to the end of the render in chunks, yielding to the
 * event loop between them with the live context restored, so a long export
 * neither blocks the page nor holds the global swap across a yield.
 * Resolves `"stopped"` if `shouldStop` asked it to, otherwise `"done"`.
 */
export async function runOfflineClock(
  context: Tone.OfflineContext,
  options: RunOfflineClockOptions = {},
): Promise<"done" | "stopped"> {
  const chunkSeconds = options.chunkSeconds ?? DEFAULT_CLOCK_CHUNK_SECONDS;
  const scheduler = options.scheduler ?? timeoutScheduler;
  const duration = clockInternals(context)._duration;
  let until = 0;
  for (;;) {
    if (options.shouldStop?.()) return "stopped";
    until += chunkSeconds;
    const finished = advanceOfflineClock(context, until);
    options.onProgress?.(finished ? 1 : Math.min(1, until / duration));
    if (finished) return "done";
    await options.afterChunk?.(until);
    await new Promise<void>((resolve) => scheduler.schedule(resolve, 0));
  }
}

/**
 * A `Tone.OfflineContext` on the platform's **native** `OfflineAudioContext`
 * where there is one. Tone's wrapped context makes an offline render's
 * connections only as rendering starts, never breaks one, and cannot suspend,
 * so a voice built or disposed mid-render would never reach it. A native one
 * can render in step with the clock (below); without one, Tone's is the fallback.
 */
export function createOfflineContext(
  channels: number,
  frames: number,
  sampleRate: number,
): Tone.OfflineContext {
  const Native = globalThis.OfflineAudioContext;
  if (typeof Native !== "function") {
    // Half a frame over, so the length Web Audio truncates to is `frames`.
    return new Tone.OfflineContext(channels, (frames + 0.5) / sampleRate, sampleRate);
  }
  const raw = new Native(channels, frames, sampleRate);
  return new Tone.OfflineContext(
    raw as unknown as ConstructorParameters<typeof Tone.OfflineContext>[0],
  );
}

export interface RenderInStepOptions extends Omit<RunOfflineClockOptions, "afterChunk"> {
  /** Called with the render suspended at `seconds`: everything before it has
   * rendered, so a voice that finished sounding before it can be disposed. */
  onRendered?: (seconds: number) => void;
}

/**
 * Runs the clock and the audio thread **in step**: after each clock chunk the
 * audio renders up to where the clock has reached, and pauses there. A render
 * then only holds the voices sounding around that point, as live playback
 * does, so its cost grows with the song's length rather than with notes times
 * length, and a stop takes effect at the next chunk. A context that cannot
 * suspend runs the clock through, then renders in one pass.
 * Resolves the rendered audio, or `"stopped"`.
 */
export async function renderOfflineInStep(
  context: Tone.OfflineContext,
  options: RenderInStepOptions = {},
): Promise<AudioBuffer | "stopped"> {
  const raw = context.rawContext as unknown as OfflineAudioContext;
  const pauses = schedulePauses(context, options.chunkSeconds);
  let rendering: Promise<AudioBuffer> | null = null;
  const run = (): Promise<AudioBuffer> => {
    if (rendering) {
      void raw.resume();
      return rendering;
    }
    rendering = raw.startRendering();
    // A stopped render is abandoned while paused: never an unhandled rejection.
    rendering.catch(() => {});
    return rendering;
  };
  const renderTo = async (seconds: number) => {
    for (let pause = pauses[0]; pause && pause.at <= seconds; pause = pauses[0]) {
      pauses.shift();
      await Promise.race([pause.reached, run()]);
      options.onRendered?.(pause.at);
    }
  };
  const clock = await runOfflineClock(context, { ...options, afterChunk: renderTo });
  if (clock === "stopped") return "stopped";
  await renderTo(Number.POSITIVE_INFINITY);
  return run();
}

/**
 * Suspends the render at the block boundary at or before each chunk's end,
 * all before rendering starts: not every implementation accepts one after.
 */
function schedulePauses(context: Tone.OfflineContext, chunkSeconds?: number) {
  const raw = context.rawContext as unknown as Partial<OfflineAudioContext>;
  const pauses: { at: number; reached: Promise<void> }[] = [];
  if (typeof raw.suspend !== "function") return pauses;
  const chunk = chunkSeconds ?? DEFAULT_CLOCK_CHUNK_SECONDS;
  const block = 128 / context.sampleRate;
  // Stepped exactly as `runOfflineClock` steps its chunks.
  for (let until = chunk; until < clockInternals(context)._duration; until += chunk) {
    const at = Math.floor(until / block) * block;
    if (at > (pauses.at(-1)?.at ?? 0))
      pauses.push({ at, reached: raw.suspend.call(raw, at) });
  }
  return pauses;
}
