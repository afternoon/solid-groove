import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, onCleanup } from "solid-js";
import type { TrackId } from "../domain/ids";

export interface LevelMeterProps {
  readonly trackId: TrackId;
  trackLevelDb(trackId: string): number | null;
  isPlaying(): boolean;
  readonly requestFrame?: (callback: () => void) => number;
  readonly cancelFrame?: (handle: number) => void;
  /**
   * A mixer strip's meter stands beside its fader; the instrument header's
   * lies along the row and fills in the track's colour (#447).
   */
  readonly orientation?: "vertical" | "horizontal";
}

/** Floor of the meter display, in dBFS. Below this reads as silence. */
const METER_FLOOR_DB = -60;

export default function LevelMeter(props: LevelMeterProps): JSX.Element {
  const [levelDb, setLevelDb] = createSignal(METER_FLOOR_DB);
  const requestFrame =
    props.requestFrame ??
    ((callback) =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => callback())
        : (setTimeout(callback, 33) as unknown as number));
  const cancelFrame =
    props.cancelFrame ??
    ((handle) => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
      else clearTimeout(handle);
    });

  let frame: number | null = null;

  function poll(): void {
    if (!props.isPlaying()) {
      setLevelDb(METER_FLOOR_DB);
      frame = null;
      return;
    }
    const db = props.trackLevelDb(props.trackId);
    setLevelDb(db === null || !Number.isFinite(db) ? METER_FLOOR_DB : db);
    frame = requestFrame(poll);
  }

  // Restart the poll loop whenever playback begins; the loop stops itself when
  // playback ends (see `poll`). `props.isPlaying()` is the effect's only
  // reactive read, so it is the whole compute half; scheduling the frame is a
  // side effect and belongs in the apply half.
  createEffect(
    () => props.isPlaying(),
    (playing) => {
      if (playing && frame === null) {
        frame = requestFrame(poll);
      }
    },
  );

  // This stays a component-scoped `onCleanup` rather than riding the apply
  // half's return: it cancels an outstanding frame when the meter goes away,
  // not on every `isPlaying` change. Returning it from the apply would cancel
  // the loop the instant playback stopped, and `poll` would never get its
  // final tick to reset the meter to the floor.
  onCleanup(() => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
  });

  const clamped = () => Math.max(METER_FLOOR_DB, Math.min(0, levelDb()));
  const fillFraction = () => (clamped() - METER_FLOOR_DB) / -METER_FLOOR_DB;

  // A native <meter> carries the level's role and value for assistive tech for
  // free (no hand-rolled ARIA to drift), while the custom bar overlay gives the
  // vertical VU look a bare <meter> can't be styled into. The two share one
  // value: the overlay's height is the same fraction the <meter> reports.
  return (
    <div
      class={
        props.orientation === "horizontal" ? "level-meter-horizontal" : "mixer-meter"
      }
    >
      <meter
        class="visually-hidden"
        aria-label="Level"
        min={METER_FLOOR_DB}
        max={0}
        low={-18}
        high={-6}
        value={clamped()}
      />
      <div
        class="mixer-meter-fill"
        style={{
          [props.orientation === "horizontal" ? "width" : "height"]:
            `${fillFraction() * 100}%`,
        }}
      />
    </div>
  );
}
