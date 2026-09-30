import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

export type ExportFormat = "stereo" | "stems";

interface Card {
  readonly format: ExportFormat;
  /** The radio's accessible name, and the card's eyebrow. */
  readonly name: string;
  readonly title: string;
  readonly text: string;
}

const CARDS: readonly Card[] = [
  {
    format: "stereo",
    name: "Stereo WAV",
    title: "Share a mix",
    text: "One file of the song as you hear it. Ready to send or upload.",
  },
  {
    format: "stems",
    name: "Stems (ZIP)",
    title: "Stems for hand off",
    text: "One WAV per track, lined up at bar 1, for mixing in another DAW.",
  },
];

export interface FormatCardsProps {
  readonly value: ExportFormat;
  /** An export is running: the choice is fixed. */
  readonly disabled?: boolean;
  onChange(format: ExportFormat): void;
}

/**
 * The format switch of the Release design (EXP-004): two full-width cards side
 * by side, the chosen one white. Each card is a label over a real radio, hidden
 * but focusable, so the pair keeps native arrow-key movement and its names.
 */
export default function FormatCards(props: FormatCardsProps): JSX.Element {
  return (
    <fieldset class="export-cards" disabled={props.disabled}>
      <legend class="visually-hidden">Format</legend>
      <For each={CARDS}>
        {(card) => (
          <label class={["export-card", { checked: props.value === card.format }]}>
            <input
              type="radio"
              class="visually-hidden"
              name="export-format"
              value={card.format}
              aria-label={card.name}
              checked={props.value === card.format}
              onChange={() => props.onChange(card.format)}
            />
            <span class="export-label export-card-eyebrow" aria-hidden="true">
              {card.name}
            </span>
            <b>{card.title}</b>
            <span class="export-card-text">{card.text}</span>
          </label>
        )}
      </For>
    </fieldset>
  );
}
