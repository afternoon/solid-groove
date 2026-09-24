import type { Analytics } from "../analytics/analytics";
import { bucketOf } from "../analytics/buckets";
import { setLoopEnabled, setLoopRange } from "../commands/definitions/loop";
import type { TransactionResult } from "../commands/execute";
import type { RawCommandInput } from "../commands/types";
import type { Project } from "../domain/entities";
import { ticksToBars } from "../domain/time";

/**
 * The two loop edits, and the events they report (LOOP-017).
 *
 * The brace is project state, so both go through the command layer and the
 * surface never writes `song.loop` itself. They live here rather than inside a
 * component because two surfaces reach them — the transport bar's loop button
 * today, the ruler's drag once #280 lands — and both have to produce the same
 * transaction and the same single event.
 *
 * An event is logged only after the transaction commits, so a refused edit
 * reports nothing: analytics describes what happened to the project, not what
 * a pointer attempted.
 */

export interface LoopControlsOptions {
  /** The project being edited, or `null` before one has loaded. */
  project(): Project | null;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  readonly analytics: Analytics;
}

export interface LoopControls {
  /** Whether the transport is obeying the brace right now. */
  isEnabled(): boolean;
  /**
   * Redefine the range from raw ticks — the command snaps them to bars. A drag
   * calls this once per committed edit, not once per frame: the ruler wraps
   * the drag in a history gesture and this is the value it let go on, so one
   * drag is one `loop_range_set`.
   */
  setRange(startTicks: number, endTicks: number): void;
  setEnabled(enabled: boolean): void;
  toggle(): void;
}

export function createLoopControls(options: LoopControlsOptions): LoopControls {
  const isEnabled = () => options.project()?.song.loop.enabled ?? false;

  function setRange(startTicks: number, endTicks: number): void {
    const result = options.dispatch(setLoopRange(startTicks, endTicks));
    if (!result?.ok) return;
    const loop = result.project.song.loop;
    options.analytics.log("loop_range_set", {
      // The length the range actually became, after the command snapped it —
      // bucketed in bars, so the report never carries an exact arrangement
      // length, and never a project, track, or clip name.
      length_bars_bucket: bucketOf(
        "loop_length_bars",
        ticksToBars(loop.endTicks - loop.startTicks),
      ),
    });
  }

  function setEnabled(enabled: boolean): void {
    if (!options.dispatch(setLoopEnabled(enabled))?.ok) return;
    options.analytics.log("loop_enabled_set", { enabled });
  }

  return {
    isEnabled,
    setRange,
    setEnabled,
    toggle: () => setEnabled(!isEnabled()),
  };
}
