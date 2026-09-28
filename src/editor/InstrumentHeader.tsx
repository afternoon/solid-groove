import { For, type JSX, Show } from "@solidjs/web";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import type { InstrumentHeaderFacts } from "./instrumentHeader";
import "./InstrumentHeader.css";

export interface InstrumentHeaderProps {
  readonly facts: InstrumentHeaderFacts;
  /** The track's name, chosen by the user (ADR 0002). */
  readonly trackName: string;
  /** The loud action at the right edge, when this instrument can be heard. */
  readonly audition?: { readonly label: string; run(): void };
}

/**
 * The instrument's header row (#447): the track's colour edge, its slot and
 * kind over its name, a few key readouts, and Audition, bold at the right.
 */
export default function InstrumentHeader(props: InstrumentHeaderProps): JSX.Element {
  return (
    <header class="instrument-header">
      <div class="instrument-header-track">
        <span class="instrument-header-label">
          {props.facts.slot} · {props.facts.kind}
        </span>
        <span class={`instrument-header-name ${MASK_CONTENT}`}>{props.trackName}</span>
      </div>
      <dl class="instrument-header-readouts">
        <For each={props.facts.readouts}>
          {(readout) => (
            <div class="instrument-header-readout">
              <dt class="instrument-header-label">{readout.label}</dt>
              <dd class={readout.masked ? MASK_CONTENT : undefined}>{readout.value}</dd>
            </div>
          )}
        </For>
      </dl>
      <Show when={props.audition}>
        {(audition) => (
          <button
            type="button"
            class="instrument-header-audition"
            onClick={() => audition().run()}
          >
            {audition().label}
          </button>
        )}
      </Show>
    </header>
  );
}
