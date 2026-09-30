import { ticksToSeconds } from "../domain/time";
import type { AudioSongProjection } from "../projection/audioProjection";

/**
 * How long an offline render runs and where it ends (EXP-001).
 *
 * A render runs from bar 1 to the end of the last placement, then keeps going
 * so a release or an effect tail can ring out, and is finally trimmed back to
 * the last sample that is still audible. It is never shorter than the song:
 * trailing silence *inside* the arrangement is part of the song, and only what
 * follows the last clip is a tail.
 */

/**
 * The longest a tail may ring past the end of the last clip, in seconds. The
 * render always runs this far beyond the song and is trimmed back afterwards,
 * so a tail that dies sooner costs only render time, never output length.
 *
 * It bounds the pathological settings the parameter ranges allow on purpose —
 * a 30 s reverb at full size, or a delay at 0.99 feedback, ring for minutes —
 * rather than sizing the render to them.
 */
export const MAX_TAIL_SECONDS = 30;

/** Below this peak amplitude (-100 dBFS) a sample counts as silence: well
 * under anything audible or a 16-bit file can hold, and far above float noise. */
export const SILENCE_THRESHOLD = 1e-5;

/** A tail still sounding when the render budget runs out is faded over this
 * long rather than cut, so a runaway delay does not end on a click. */
export const TRUNCATION_FADE_SECONDS = 0.05;

/** The tick at which the last placement ends: where the song ends. */
export function songEndTicks(
  projection: Pick<AudioSongProjection, "placements">,
): number {
  let end = 0;
  for (const placement of projection.placements) {
    end = Math.max(end, placement.startTicks + placement.durationTicks);
  }
  return end;
}

/** The end of the song in seconds at its own tempo. */
export function songEndSeconds(
  projection: Pick<AudioSongProjection, "placements" | "tempo">,
): number {
  return ticksToSeconds(songEndTicks(projection), projection.tempo);
}

export interface TrimmedRender {
  /** One array per channel, `frames` long; copies, not views of the input. */
  readonly channels: Float32Array[];
  readonly frames: number;
  /** True when the tail was still sounding at the end of the render budget. */
  readonly truncated: boolean;
}

/**
 * Trims a render to the end of its audible tail, never before `minFrames` (the
 * end of the song). A tail still above the silence threshold at the very end
 * of the rendered buffer is kept whole and faded out over its last
 * {@link TRUNCATION_FADE_SECONDS}. Nothing else touches a sample's level.
 */
export function trimRenderedTail(
  channels: readonly Float32Array[],
  sampleRate: number,
  minFrames: number,
): TrimmedRender {
  const length = channels[0]?.length ?? 0;
  let lastAudible = -1;
  for (const data of channels) {
    for (let i = data.length - 1; i > lastAudible; i--) {
      if (Math.abs(data[i]) > SILENCE_THRESHOLD) {
        lastAudible = i;
        break;
      }
    }
  }
  const frames = Math.min(length, Math.max(minFrames, lastAudible + 1));
  const truncated = lastAudible === length - 1 && length > minFrames;
  const trimmed = channels.map((data) => data.slice(0, frames));
  if (truncated) {
    const fadeFrames = Math.min(
      frames - minFrames,
      Math.round(TRUNCATION_FADE_SECONDS * sampleRate),
    );
    for (const data of trimmed) {
      for (let i = 0; i < fadeFrames; i++) {
        data[frames - 1 - i] *= i / fadeFrames;
      }
    }
  }
  return { channels: trimmed, frames, truncated };
}
