import { For, type JSX, Show } from "@solidjs/web";
import { createMemo, createSignal, onCleanup } from "solid-js";
import { ariaBool } from "../shared/aria";
import { AuditionController, type PreviewEngine } from "./audition";
import MiniWaveform from "./MiniWaveform";
import type { LibraryAsset } from "./manifest";
import { ALL_MATCH_ON, type MatchOn, similarSounds } from "./similarity";
import "./SimilarSoundsView.css";

const CRITERIA: readonly { key: keyof MatchOn; label: string }[] = [
  { key: "category", label: "Category" },
  { key: "genre", label: "Genre" },
  { key: "length", label: "Length" },
];

/** Length as a row shows it: bars for a loop, seconds otherwise. */
function lengthLabel(asset: LibraryAsset): string {
  if (asset.type === "loop") return asset.bars === null ? "" : `${asset.bars} bars`;
  return asset.durationSeconds === null ? "" : `${asset.durationSeconds.toFixed(2)}s`;
}

export interface SimilarSoundsViewProps {
  /** The sound the view starts from; hopping extends the trail from here. */
  readonly reference: LibraryAsset;
  /** Every asset of every pack: candidates come from all of them. */
  readonly library: readonly LibraryAsset[];
  /** A result was clicked: the host selects it (and so Insert inserts it). */
  onSelect(asset: LibraryAsset): void;
  /** Back to the list the view was opened from. */
  onBack(): void;
  /** What the list is called, for the back button ("Kicks"). */
  readonly backLabel?: string;
  /** Auditions results and the reference. Without one the view is silent. */
  readonly previewEngine?: PreviewEngine;
  /** The selected row's waveform colour. */
  readonly trackColor?: string;
}

/**
 * The similar-sounds view (`LIB-010`): "Match on" chips, and
 * the closest sounds from every pack in the reference's family, each with a
 * percentage. The view owns only its chips and audition; scoring is
 * `similarSounds` and selection belongs to the host.
 */
export default function SimilarSoundsView(props: SimilarSoundsViewProps): JSX.Element {
  const [matchOn, setMatchOn] = createSignal<MatchOn>(ALL_MATCH_ON);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  const reference = () => props.reference;
  const results = createMemo(() => similarSounds(reference(), props.library, matchOn()));

  const audition = props.previewEngine
    ? new AuditionController(props.previewEngine)
    : null;
  onCleanup(() => audition?.stop());

  function select(asset: LibraryAsset): void {
    setSelectedId(asset.id);
    props.onSelect(asset);
    void audition?.play(asset);
  }

  return (
    <section class="similar-view" aria-label="Similar sounds view">
      <div class="similar-head">
        <button type="button" class="similar-back" onClick={() => props.onBack()}>
          {props.backLabel ? `Back to ${props.backLabel}` : "Back"}
        </button>
      </div>
      <fieldset class="similar-filters" aria-label="Match on">
        <span class="similar-label">Match on</span>
        <For each={CRITERIA}>
          {(criterion) => (
            <button
              type="button"
              class="similar-chip"
              aria-pressed={ariaBool(matchOn()[criterion.key])}
              onClick={() =>
                setMatchOn({
                  ...matchOn(),
                  [criterion.key]: !matchOn()[criterion.key],
                })
              }
            >
              {criterion.label}
            </button>
          )}
        </For>
        <span class="similar-count">{results().length} closest from every pack</span>
      </fieldset>
      <Show
        when={results().length > 0}
        fallback={
          <p class="similar-empty">
            Nothing to compare on. Turn a Match on chip back on.
          </p>
        }
      >
        <ul class="similar-list" aria-label="Similar sounds">
          <For each={results()}>
            {(result) => (
              <li
                class={[
                  "similar-row",
                  { "similar-row-selected": selectedId() === result.asset.id },
                ]}
                style={{
                  "--waveform-fill":
                    selectedId() === result.asset.id
                      ? (props.trackColor ?? "currentColor")
                      : undefined,
                }}
              >
                <button
                  type="button"
                  class="similar-pick"
                  aria-label={`Audition ${result.asset.name}`}
                  aria-pressed={ariaBool(selectedId() === result.asset.id)}
                  onClick={() => select(result.asset)}
                >
                  <span class="similar-wave">
                    <MiniWaveform peaks={result.asset.peaks} />
                  </span>
                  <span class="similar-name">
                    <b>{result.asset.name}</b>
                    <span>
                      {result.asset.packName} · {result.asset.role}
                    </span>
                  </span>
                  <span class="similar-match" title={`${result.percent}% match`}>
                    <span class="similar-meter">
                      <span
                        class="similar-meter-fill"
                        style={{ width: `${result.percent}%` }}
                      />
                    </span>
                    <span>{result.percent}%</span>
                  </span>
                  <span class="similar-length">{lengthLabel(result.asset)}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
