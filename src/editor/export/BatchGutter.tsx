import type { JSX } from "@solidjs/web";
import { createMemo, For } from "solid-js";
import "./BatchGutter.css";
import { ROW_HEIGHT_PX } from "./trackLanesCanvas";

/**
 * The gutter between the names and the lanes (EXP-004): one numbered bracket per
 * ZIP beside the rows it holds, so the split reads before anything is exported.
 * Shown only for two or more batches. The batch being printed is the brightest;
 * finished batches are filled. Decorative: the Downloads row says it in words.
 */

export interface BatchGutterProps {
  /** Every row id, top to bottom. */
  readonly rowIds: readonly string[];
  /** The stem batches, each the row ids it holds. */
  readonly batches: readonly (readonly string[])[];
  readonly doneBatches?: readonly number[];
  /** The batch being printed, if one is. */
  readonly printingBatch?: number | null;
}

export default function BatchGutter(props: BatchGutterProps): JSX.Element {
  const brackets = createMemo(() => {
    if (props.batches.length < 2) return [];
    return props.batches.flatMap((ids, k) => {
      const at = ids.map((id) => props.rowIds.indexOf(id)).filter((i) => i >= 0);
      if (at.length === 0) return [];
      const done = props.doneBatches?.includes(k) === true;
      const state = done ? "done" : props.printingBatch === k ? "now" : "waiting";
      return [{ k, first: Math.min(...at), last: Math.max(...at), state }];
    });
  });
  return (
    <div
      class="batch-gutter"
      aria-hidden="true"
      style={{ height: `${props.rowIds.length * ROW_HEIGHT_PX}px` }}
    >
      <For each={brackets()}>
        {(bracket) => (
          <div
            class="batch-bracket"
            data-state={bracket.state}
            style={{
              top: `${bracket.first * ROW_HEIGHT_PX + 3}px`,
              height: `${(bracket.last - bracket.first + 1) * ROW_HEIGHT_PX - 6}px`,
            }}
          >
            <span>{bracket.k + 1}</span>
          </div>
        )}
      </For>
    </div>
  );
}
