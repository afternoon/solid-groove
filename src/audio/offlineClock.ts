import * as Tone from "tone";
import { type Scheduler, timeoutScheduler } from "../shared/scheduler";

/**
 * The part of an offline render that runs inside Tone's JavaScript clock:
 * firing transport events, and the nodes they build. Not `Tone.Offline()`:
 * every voice (a sampler note, a drum hit, a loop player) is built in a
 * transport callback, bound to whatever `Tone.getContext()` is *then*, and
 * `Tone.Offline()` restores the live context once rendering starts, so its
 * clock builds every note in the wrong context. Holding the offline context
 * for the whole render would be worse: live callbacks would build *their*
 * voices offline, silencing live playback (EXP-001). So the global context is
 * swapped only for **synchronous** work, and restored before every yield.
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
 * The two private fields Tone's own `_renderClock` loop drives, stepped here
 * so the clock runs in chunks. The tests pin them against the public
 * `currentTime`, so a Tone upgrade that renames them fails there, not silently.
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
 * Advances the offline clock a 128-frame block per tick, as `_renderClock`
 * does, with the offline context installed globally, until it passes
 * `until` seconds or the render's end. Returns whether it reached the end.
 */
export function advanceOfflineClock(context: Tone.OfflineContext, until: number) {
  const clock = clockInternals(context);
  const blockSeconds = 128 / context.sampleRate;
  withGlobalContext(context, () => {
    while (clock._duration - clock._currentTime >= 0 && clock._currentTime <= until) {
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

/** Short synchronous spans, yet few yields (each at least one event-loop turn). */
export const DEFAULT_CLOCK_CHUNK_SECONDS = 5;

/**
 * Runs the offline clock to the end in chunks, yielding between them with the
 * live context restored, so a long export never blocks the page. Resolves
 * `"stopped"` if `shouldStop` asked it to, otherwise `"done"`.
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
 * A `Tone.OfflineContext` on a **native** `OfflineAudioContext` if there is
 * one: Tone's own connects only as rendering starts and cannot suspend, so a
 * voice built or disposed mid-render never reaches it. It is the fallback.
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
 * Runs the clock and the audio **in step**: after each clock chunk the audio
 * renders to where the clock reached, and pauses. A render then holds only the
 * voices sounding near that point, as live playback does, and a stop takes
 * effect at the next chunk. A context that cannot suspend renders in one pass
 * after the clock. Resolves the audio, or `"stopped"`.
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
    // Never an unhandled rejection, however the render ends.
    rendering.catch(() => {});
    return rendering;
  };
  const end = Number.POSITIVE_INFINITY;
  const renderTo = async (seconds: number, onRendered = options.onRendered) => {
    for (let pause = pauses[0]; pause && pause.at <= seconds; pause = pauses[0]) {
      pauses.shift();
      await Promise.race([pause.reached, run()]);
      onRendered?.(pause.at);
    }
  };
  try {
    const clock = await runOfflineClock(context, { ...options, afterChunk: renderTo });
    if (clock === "stopped") return "stopped";
    await renderTo(end);
    return await run();
  } finally {
    // Stopped, or failed, while paused part-way: leave the rest to finish.
    if (rendering && raw.state === "suspended")
      unfinished.set(context, () => renderTo(end, () => {}).then(run));
  }
}

const unfinished = new WeakMap<Tone.OfflineContext, () => Promise<unknown>>();

/** Lets a render `renderOfflineInStep` stopped or failed part-way run to its end:
 * left paused, a native context holds its buffer and render thread for good.
 * Call it once the graph is torn down, so the rest renders silence, fast. */
export async function finishOfflineRender(context: Tone.OfflineContext): Promise<void> {
  const finish = unfinished.get(context);
  unfinished.delete(context);
  await finish?.().catch(() => {});
}

/** Suspends the render at the block at or before each chunk's end, all before
 * it starts: not every implementation accepts a suspend after. */
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
