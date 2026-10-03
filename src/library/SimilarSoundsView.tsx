import { For, type JSX, Show } from "@solidjs/web";
import { createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { PlayIcon, StopIcon } from "../components/icons";
import { ariaBool } from "../shared/aria";
import { AuditionController, type PreviewEngine } from "./audition";
import MiniWaveform from "./MiniWaveform";
import type { LibraryAsset } from "./manifest";
import SoundRow, { lengthLabel, SimilarIcon } from "./SoundRow";
import { roleLabel } from "./shelf";
import { ALL_MATCH_ON, type MatchOn, similarSounds } from "./similarity";
import { tabStopId } from "./stepping";
import "./SimilarSoundsView.css";

const CRITERIA: readonly { key: keyof MatchOn; label: string }[] = [
  { key: "category", label: "Category" },
  { key: "genre", label: "Genre" },
  { key: "length", label: "Length" },
];

/** The back button's chevron, pointing where it goes. */
function ChevronLeft(): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      aria-hidden="true"
    >
      <path d="M10 2L4 8l6 6" />
    </svg>
  );
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
  /** What the list is called, for the back button ("Kicks", "All drums", a pack). */
  readonly backLabel?: string;
  /** Auditions results and the reference. Without one the view is silent. */
  readonly previewEngine?: PreviewEngine;
  /** The selected row's waveform colour. */
  readonly trackColor?: string;
}

/**
 * The similar-sounds view (`LIB-010`): a reference card, "Match on" chips, and
 * the closest sounds from every pack in the reference's family, each a sound
 * row with a match meter. The similar icon on a result hops on from it and the
 * trail lets you jump back. The view owns only its trail, chips and audition;
 * scoring is `similarSounds` and selection belongs to the host.
 */
export default function SimilarSoundsView(props: SimilarSoundsViewProps): JSX.Element {
  const [trail, setTrail] = createSignal<readonly LibraryAsset[]>([
    untrack(() => props.reference),
  ]);
  const [matchOn, setMatchOn] = createSignal<MatchOn>(ALL_MATCH_ON);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [playingId, setPlayingId] = createSignal<string | null>(null);

  const reference = () => trail()[trail().length - 1];
  const results = createMemo(() => similarSounds(reference(), props.library, matchOn()));
  // The list is one Tab stop (#880): the selected result, or the first.
  const tabStop = createMemo(() =>
    tabStopId(
      results().map((result) => result.asset.id),
      selectedId(),
    ),
  );

  const audition = props.previewEngine
    ? new AuditionController(props.previewEngine, { onActiveChange: setPlayingId })
    : null;
  onCleanup(() => audition?.stop());

  function toggleAudition(asset: LibraryAsset): void {
    if (playingId() === asset.id) audition?.stop();
    else void audition?.play(asset);
  }

  function select(asset: LibraryAsset): void {
    setSelectedId(asset.id);
    props.onSelect(asset);
    void audition?.play(asset);
  }

  function hop(asset: LibraryAsset): void {
    audition?.stop();
    setTrail([...trail(), asset]);
  }

  function jumpTo(index: number): void {
    audition?.stop();
    setTrail(trail().slice(0, index + 1));
  }

  return (
    <section class="similar-view" aria-label="Similar sounds view">
      <div class="similar-head">
        <button
          type="button"
          class="similar-back"
          aria-label={props.backLabel ? `Back to ${props.backLabel}` : "Back"}
          onClick={() => props.onBack()}
        >
          <ChevronLeft />
          {props.backLabel ?? "Back"}
        </button>
        <nav class="similar-trail" aria-label="Similar sounds trail">
          <For each={trail()}>
            {(asset, i) => (
              <>
                <Show when={i() > 0}>
                  <span class="similar-sep" aria-hidden="true">
                    ›
                  </span>
                </Show>
                <button
                  type="button"
                  aria-current={i() === trail().length - 1 ? "location" : undefined}
                  onClick={() => jumpTo(i())}
                >
                  {asset.name}
                </button>
              </>
            )}
          </For>
        </nav>
      </div>
      <div class="similar-ref">
        <button
          type="button"
          class="similar-ref-play"
          aria-label={`Play ${reference().name}`}
          aria-pressed={ariaBool(playingId() === reference().id)}
          onClick={() => toggleAudition(reference())}
        >
          <Show when={playingId() === reference().id} fallback={<PlayIcon size={14} />}>
            <StopIcon size={14} />
          </Show>
        </button>
        <div class="similar-ref-wave" style={{ "--waveform-fill": props.trackColor }}>
          <MiniWaveform peaks={reference().peaks} />
        </div>
        <div class="similar-ref-text">
          <span class="similar-label">Sounds like</span>
          <b>{reference().name}</b>
          <span>
            {[
              reference().packName,
              roleLabel(reference().role),
              ...reference().characters,
              lengthLabel(reference()),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
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
        <span class="similar-count">
          {results().length} closest from every pack · <SimilarIcon size={11} /> on a
          result hops to its neighbours
        </span>
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
              <SoundRow
                asset={result.asset}
                selected={selectedId() === result.asset.id}
                tabbable={tabStop() === result.asset.id}
                playing={playingId() === result.asset.id}
                error={null}
                color={props.trackColor}
                match={result.percent}
                onSelect={() => select(result.asset)}
                onSimilar={() => hop(result.asset)}
              />
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
