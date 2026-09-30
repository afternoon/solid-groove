import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidExclamationTriangle } from "solid-icons/hi";
import { createMemo, createSignal, onSettled } from "solid-js";
import type { Analytics } from "../analytics/analytics";
import TapeLoader from "../components/TapeLoader";
import type { PreviewEngine } from "./audition";
import type { LibraryClient } from "./libraryClient";
import { LOAD_REASON_LABELS } from "./loadReasons";
import type { LibraryAsset, LibraryAssetType } from "./manifest";
import SoundRow from "./SoundRow";
import { matchesLibraryQuery } from "./search";
import { useLibraryBrowser } from "./useLibraryBrowser";
import "./SoundsView.css";

export interface SoundsViewProps {
  readonly client?: LibraryClient;
  readonly previewEngine?: PreviewEngine;
  readonly analytics?: Analytics;
  /** Show only these types: the Loop button opens the library on loops. */
  readonly assetTypes?: readonly LibraryAssetType[];
  /** Names the view for assistive technology; the region itself is "Library". */
  readonly heading?: string;
  readonly trackColor?: string;
  /** The header search's text, matched against name, role, family and pack. */
  readonly query?: string;
  /** The sound being heard; the modal owns it so Insert and Hearing follow it. */
  readonly selected: LibraryAsset | null;
  onSelect(asset: LibraryAsset): void;
  onSimilar(asset: LibraryAsset): void;
}

/**
 * The library's Sounds view (LIB-010): every sound in the library as compact
 * rows. Selecting a row auditions it at once;
 * inserting is the modal's Insert. The load, audition and analytics logic is
 * `useLibraryBrowser`'s; this is the view.
 */
export default function SoundsView(props: SoundsViewProps): JSX.Element {
  const browser = useLibraryBrowser({
    client: props.client,
    previewEngine: props.previewEngine,
    analytics: props.analytics,
    onSelect: (asset) => props.onSelect(asset),
  });
  const [ready, setReady] = createSignal(false);

  async function load(): Promise<void> {
    await browser.open();
    if (browser.indexError() === null) await browser.selectPack(null);
    setReady(true);
  }
  onSettled(() => void load());

  const sounds = createMemo(() => {
    const needle = (props.query ?? "").trim().toLowerCase();
    return browser
      .assets()
      .filter(
        (asset) =>
          (!props.assetTypes || props.assetTypes.includes(asset.type)) &&
          matchesLibraryQuery(asset, needle),
      );
  });
  const selectedId = () => props.selected?.id ?? null;

  return (
    <section class="sounds-view" aria-label="Library">
      <h2 class="visually-hidden">{props.heading ?? "Library"}</h2>
      <Show
        when={browser.indexError() === null}
        fallback={
          <div class="sounds-error" role="alert">
            <HiSolidExclamationTriangle size={16} />{" "}
            {LOAD_REASON_LABELS[browser.indexError() ?? "network"]}{" "}
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          </div>
        }
      >
        <Show when={ready()} fallback={<TapeLoader label="Loading library" />}>
          <Show
            when={sounds().length > 0}
            fallback={<p class="sounds-empty">No sounds to show.</p>}
          >
            <ul class="sounds-list" aria-label="Sounds">
              <For each={sounds()}>
                {(asset) => (
                  <SoundRow
                    asset={asset}
                    selected={selectedId() === asset.id}
                    playing={browser.auditioningId() === asset.id}
                    error={browser.assetErrors().get(asset.id) ?? null}
                    color={props.trackColor}
                    onSelect={() => void browser.audition(asset)}
                    onSimilar={() => props.onSimilar(asset)}
                  />
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
