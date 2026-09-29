import { For, type JSX } from "@solidjs/web";
import { type Analytics, analytics as defaultAnalytics } from "../../analytics/analytics";
import type { RawCommandInput, TransactionResult } from "../../commands";
import { setKey } from "../../commands";
import { type MusicalKey, SCALE_IDS, type ScaleId } from "../../domain/musicalKey";
import { PITCH_CLASS_NAMES } from "./rows";
import "./KeyPanel.css";

/** Each scale's name, as the scale switch and the readout use it. */
export const SCALE_LABELS: Readonly<Record<ScaleId, string>> = {
  chromatic: "Chromatic",
  major: "Major",
  minor: "Minor",
  dorian: "Dorian",
  mixolydian: "Mixolydian",
  harmonic_minor: "Harmonic minor",
  major_pentatonic: "Major pentatonic",
  minor_pentatonic: "Minor pentatonic",
  blues: "Blues",
};

/** Each scale's short name, as the one-row scale switch shows it. */
export const SCALE_SHORT_LABELS: Readonly<Record<ScaleId, string>> = {
  chromatic: "Chr",
  major: "Maj",
  minor: "Min",
  dorian: "Dor",
  mixolydian: "Mix",
  harmonic_minor: "HMin",
  major_pentatonic: "MajP",
  minor_pentatonic: "MinP",
  blues: "Blu",
};

/** "Chromatic", or the root and the scale: "C minor", "F♯ harmonic minor". */
export function keyName(key: MusicalKey): string {
  if (key.scale === "chromatic") return SCALE_LABELS.chromatic;
  return `${PITCH_CLASS_NAMES[key.root]} ${SCALE_LABELS[key.scale].toLowerCase()}`;
}

export interface KeyPanelProps {
  readonly musicalKey: MusicalKey;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  /** Defaults to the application's singleton; injectable for tests. */
  readonly analytics?: Analytics;
}

/**
 * The Key panel under the piano roll (ARR-010): a readout of the song's key,
 * a row of the twelve roots and a row of the nine scales, each shown by
 * its short name and named in full to a screen reader, the chosen one
 * in each white. Chromatic, the default, has no root, so the root pad is off
 * while it is chosen, and choosing a scale from chromatic starts on C.
 *
 * The key is the song's, so every change is one `key.set`: saved with the
 * project, undoable, and the same command the assistant would use.
 */
export default function KeyPanel(props: KeyPanelProps): JSX.Element {
  const analytics = () => props.analytics ?? defaultAnalytics;
  const chromatic = () => props.musicalKey.scale === "chromatic";

  function choose(next: MusicalKey): void {
    const current = props.musicalKey;
    if (next.root === current.root && next.scale === current.scale) return;
    const result = props.dispatch(setKey(next));
    if (result && !result.ok) return;
    analytics().logFeatureFirstUse("musical_key");
    analytics().log("key_changed", { scale: next.scale });
  }

  function chooseScale(scale: ScaleId): void {
    // A chromatic key's root is always C, so leaving chromatic starts there.
    const root = scale === "chromatic" || chromatic() ? 0 : props.musicalKey.root;
    choose({ root, scale });
  }

  return (
    <section class="key-panel" aria-label="Key">
      <div class="key-panel-head">
        <span class="key-panel-title">Key</span>
        <output class="key-panel-name">{keyName(props.musicalKey)}</output>
      </div>
      <fieldset class="key-roots" aria-label="Root" disabled={chromatic()}>
        <For each={PITCH_CLASS_NAMES}>
          {(name, index) => (
            <button
              type="button"
              aria-pressed={
                !chromatic() && props.musicalKey.root === index() ? "true" : "false"
              }
              onClick={() => choose({ root: index(), scale: props.musicalKey.scale })}
            >
              {name}
            </button>
          )}
        </For>
      </fieldset>
      <fieldset class="key-scales" aria-label="Scale">
        <For each={SCALE_IDS}>
          {(scale) => (
            <button
              type="button"
              aria-label={SCALE_LABELS[scale]}
              title={SCALE_LABELS[scale]}
              aria-pressed={props.musicalKey.scale === scale ? "true" : "false"}
              onClick={() => chooseScale(scale)}
            >
              {SCALE_SHORT_LABELS[scale]}
            </button>
          )}
        </For>
      </fieldset>
    </section>
  );
}
