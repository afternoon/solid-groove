import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidExclamationTriangle } from "solid-icons/hi";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import type { Analytics } from "../analytics/analytics";
import TapeLoader from "../components/TapeLoader";
import type { PreviewEngine } from "./audition";
import type { LibraryClient } from "./libraryClient";
import { LOAD_REASON_LABELS } from "./loadReasons";
import type { LibraryAsset, LibraryAssetType } from "./manifest";
import Shelf from "./Shelf";
import SoundRow from "./SoundRow";
import { matchesLibraryQuery } from "./search";
import type { SoundsKeyAction } from "./soundKeys";
import { nextIn, previousIn } from "./stepping";
import { useLibraryBrowser } from "./useLibraryBrowser";
import { type ShelfSlot, useShelf } from "./useShelf";
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
  /** What the library was opened for: where the shelf opens. */
  readonly slot?: ShelfSlot;
  /** The sound being heard; the modal owns it so Insert and Hearing follow it. */
  readonly selected: LibraryAsset | null;
  onSelect(asset: LibraryAsset): void;
  onSimilar(asset: LibraryAsset): void;
  /** Hands the modal this view's key handler, and takes it back when unmounted. */
  onKeys(handler: ((action: SoundsKeyAction) => void) | null): void;
}

/**
 * The library's Sounds view (LIB-010): every sound in the library as compact
 * rows. Selecting a row, by click or by the arrow keys, auditions it at once;
 * inserting is the modal's Insert. The load, audition and analytics logic is
 * `useLibraryBrowser`'s; this is the view, and its keys arrive through the
 * shortcut registry rather than a listener of its own.
 */
export default function SoundsView(props: SoundsViewProps): JSX.Element {
  const browser = useLibraryBrowser({
    client: props.client,
    previewEngine: props.previewEngine,
    analytics: props.analytics,
    onSelect: (asset) => props.onSelect(asset),
  });
  const [ready, setReady] = createSignal(false);
  let list: HTMLUListElement | undefined;

  async function load(): Promise<void> {
    await browser.open();
    if (browser.indexError() === null) await browser.selectPack(null);
    setReady(true);
  }
  onSettled(() => void load());

  const matching = createMemo(() => {
    const needle = (props.query ?? "").trim().toLowerCase();
    return browser
      .assets()
      .filter(
        (asset) =>
          (!props.assetTypes || props.assetTypes.includes(asset.type)) &&
          matchesLibraryQuery(asset, needle),
      );
  });
  const shelf = useShelf(
    matching,
    () => browser.assets(),
    () => props.slot,
  );
  const sounds = shelf.inView;
  const selectedId = () => props.selected?.id ?? null;
  const current = () => sounds().find((sound) => sound.id === selectedId()) ?? null;

  /** Select the neighbouring sound, which auditions it; the ends hold. */
  function step(direction: 1 | -1): void {
    const from = current();
    const target = (direction === 1 ? nextIn : previousIn)(sounds(), from);
    if (target && target !== from) void browser.audition(target);
  }

  function press(action: SoundsKeyAction): void {
    const sound = current();
    if (action === "library.select_next") step(1);
    else if (action === "library.select_previous") step(-1);
    else if (action === "library.audition" && sound) void browser.audition(sound);
    else if (action === "library.similar" && sound) props.onSimilar(sound);
  }

  onSettled(() => {
    props.onKeys(press);
    return () => props.onKeys(null);
  });

  // Keep the heard row on screen as the arrow keys walk the list.
  createEffect(selectedId, () => {
    list?.querySelector(".sound-row-selected")?.scrollIntoView?.({ block: "nearest" });
  });

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
          <Shelf
            families={shelf.families()}
            family={shelf.selection().family}
            roles={shelf.roles()}
            role={shelf.selection().role}
            onFamily={shelf.setFamily}
            onRole={shelf.setRole}
          />
          <Show
            when={sounds().length > 0}
            fallback={<p class="sounds-empty">No sounds to show.</p>}
          >
            <ul class="sounds-list" aria-label="Sounds" ref={list}>
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
