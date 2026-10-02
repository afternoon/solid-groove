import { For, type JSX } from "@solidjs/web";
import { createMemo } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { RawCommandInput } from "../commands";
import { updateClip } from "../commands";
import type { Clip } from "../domain/entities";
import { TICKS_PER_BAR } from "../domain/time";
import { barCount, barOptions, MAX_BARS, MIN_BARS } from "./stepEditorModel";
import "./ClipLengthControl.css";

export interface ClipLengthControlProps {
  readonly clip: Clip;
  dispatch(commands: RawCommandInput | readonly RawCommandInput[]): unknown;
  /** Defaults to the application singleton; injectable for tests. */
  readonly analytics?: Analytics;
}

/**
 * The clip's Bars control, shared by the step grid and the piano roll (#869):
 * the musical lengths from `barOptions`, each choice one `clip.update` that
 * lengthens or shortens the clip. Notes past a shortened end stay in the clip,
 * unheard, and come back when it is lengthened again.
 */
export default function ClipLengthControl(props: ClipLengthControlProps): JSX.Element {
  const bars = createMemo(() => barCount(props.clip));

  function resizeToBars(nextBars: number): void {
    const clamped = Math.min(MAX_BARS, Math.max(MIN_BARS, Math.round(nextBars)));
    const lengthTicks = clamped * TICKS_PER_BAR;
    if (lengthTicks === props.clip.lengthTicks) return;
    props.dispatch(
      updateClip(props.clip.id, {
        lengthTicks: lengthTicks as Clip["lengthTicks"],
      }),
    );
    (props.analytics ?? defaultAnalytics).logFeatureFirstUse("clip_length");
  }

  return (
    <label class="clip-length">
      <span class="clip-length-label">Bars</span>
      <select
        class="clip-length-select"
        value={bars()}
        onChange={(event) => resizeToBars(Number(event.currentTarget.value))}
      >
        <For each={barOptions(props.clip)}>
          {(count) => <option value={count}>{count}</option>}
        </For>
      </select>
    </label>
  );
}
