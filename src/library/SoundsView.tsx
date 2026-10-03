import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidExclamationTriangle } from "solid-icons/hi";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import type { Analytics } from "../analytics/analytics";
import TapeLoader from "../components/TapeLoader";
import type { ShortcutActionId } from "../shortcuts";
import type { PreviewEngine } from "./audition";
import FilterRow from "./FilterRow";
import { filterSounds, genreCounts, roleJumps } from "./filters";
import type { LibraryClient } from "./libraryClient";
import { LOAD_REASON_LABELS } from "./loadReasons";
import type { LibraryAsset, LibraryAssetType, LibraryPackSummary } from "./manifest";
import Shelf, { allLabel } from "./Shelf";
import SoundRow from "./SoundRow";
import { shelfFamilyOf } from "./shelf";
import type { SoundsKeyAction } from "./soundKeys";
import { nextIn, previousIn, revealSelectedRow, tabStopId } from "./stepping";
import { groupLabel } from "./tree";
import { useLibraryBrowser } from "./useLibraryBrowser";
import { type ShelfSlot, useShelf } from "./useShelf";
import { useSoundFilters } from "./useSoundFilters";
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
  /**
   * Scope the list to one pack (LIB-010): an opened pack shows only its own
   * sounds, under the same shelf and filters. `null` or unset is every pack.
   */
  readonly packSlug?: string | null;
  /** The song's tempo, which Tempo under Loops measures "near" from. */
  readonly songBpm?: number;
  /** Clears the header search, which the empty state's *Clear the filters* does. */
  onQueryChange?(query: string): void;
  /** What the library was opened for: where the shelf opens. */
  readonly slot?: ShelfSlot;
  /** Key badge text for a registry action, from the registry. */
  keyLabel?(action: ShortcutActionId): string | undefined;
  /** The sound being heard; the modal owns it so Insert and Hearing follow it. */
  readonly selected: LibraryAsset | null;
  onSelect(asset: LibraryAsset): void;
  onSimilar(asset: LibraryAsset): void;
  /** The list in view's name ("Kicks", "All drums", a pack's), for a way back to it. */
  onListLabel?(label: string): void;
  /** Hands the modal this view's key handler, and takes it back when unmounted. */
  onKeys(handler: ((action: SoundsKeyAction) => void) | null): void;
  /**
   * Hands the modal this view's Escape step (#874): close the genre menu and
   * return focus to its button, false when it was not open.
   */
  onCloseMenu?(close: (() => boolean) | null): void;
  /**
   * Sounds from outside the published library — the producer's own packs
   * (#282) — listed, searched and filtered alongside it, and their packs.
   */
  readonly extraAssets?: readonly LibraryAsset[];
  readonly extraPacks?: readonly LibraryPackSummary[];
  /**
   * Hands the library this view's audition, so a sound listed elsewhere in the
   * view (a personal pack in the rail) is heard through the same one voice.
   */
  onAuditioner?(handler: ((asset: LibraryAsset) => void) | null): void;
}

/**
 * The library's Sounds view (LIB-010): every sound in the library as compact
 * rows. Selecting a row, by click or by the arrow keys, auditions it at once;
 * inserting is the modal's Insert. The load, audition and analytics logic is
 * `useLibraryBrowser`'s; this is the view, and its keys arrive through the
 * shortcut registry rather than a listener of its own.
 */
/** Clients that have loaded the library once, so their next visit is instant. */
const warmClients = new WeakSet<LibraryClient>();

export default function SoundsView(props: SoundsViewProps): JSX.Element {
  const browser = useLibraryBrowser({
    client: props.client,
    previewEngine: props.previewEngine,
    analytics: props.analytics,
    onSelect: (asset) => props.onSelect(asset),
    extraPacks: () => props.extraPacks ?? [],
  });
  const [ready, setReady] = createSignal(false);
  // The loader is for the first load only. A later visit with the same client
  // finds the index and manifests cached, so it settles at once and opens
  // straight on the list rather than flashing the loader again (UI-002).
  const client = props.client;
  const loaderShown = !(client && warmClients.has(client));
  let list: HTMLUListElement | undefined;

  async function load(): Promise<void> {
    await browser.open();
    if (browser.indexError() === null) await browser.selectPack(null);
    if (client && browser.indexError() === null) warmClients.add(client);
    setReady(true);
  }
  onSettled(() => void load());

  const filters = useSoundFilters(() => props.songBpm ?? 120);
  const [genreMenuOpen, setGenreMenuOpen] = createSignal(false);
  let genreButton: HTMLButtonElement | undefined;

  /** Escape's innermost step: the menu closes onto its button, the library stays. */
  function closeGenreMenu(): boolean {
    if (!genreMenuOpen()) return false;
    setGenreMenuOpen(false);
    genreButton?.focus();
    return true;
  }
  const typed = createMemo(() =>
    [...browser.assets(), ...(props.extraAssets ?? [])]
      .filter((asset) => !props.assetTypes || props.assetTypes.includes(asset.type))
      .filter((asset) => !props.packSlug || asset.packSlug === props.packSlug),
  );
  const matching = createMemo(() =>
    filterSounds(typed(), filters.read(props.query ?? "")),
  );
  // Every family in scope keeps its tab through a search or filter, at zero if
  // nothing in it matches, so the window stays put and shows where hits are.
  const shelf = useShelf(
    matching,
    () => browser.assets(),
    () => props.slot,
    typed,
  );
  const sounds = shelf.inView;
  const family = () => shelf.selection().family;
  // The genre menu counts what the other filters leave, in the family in view.
  const genres = createMemo(() =>
    genreCounts(
      filterSounds(typed(), { ...filters.read(props.query ?? ""), genres: [] }).filter(
        (asset) => shelfFamilyOf(asset) === family(),
      ),
    ),
  );
  // Roles the search names ("Closed hat"), from the sounds before the text filter.
  const jumps = createMemo(() => {
    const query = props.query ?? "";
    return roleJumps(filterSounds(typed(), filters.read("")), query);
  });
  const narrowed = () => filters.active() || (props.query ?? "").trim() !== "";

  // An opened pack starts under every pack's shelf and filters, but what the
  // producer changes inside it stays there: leaving puts every pack's back (#875).
  let outsidePack: {
    shelf: ReturnType<typeof shelf.picked>;
    filters: ReturnType<typeof filters.snapshot>;
  } | null = null;
  createEffect(
    () => props.packSlug ?? null,
    (slug) => {
      if (slug !== null && outsidePack === null) {
        outsidePack = { shelf: shelf.picked(), filters: filters.snapshot() };
      } else if (slug === null && outsidePack !== null) {
        shelf.restore(outsidePack.shelf);
        filters.restore(outsidePack.filters);
        outsidePack = null;
      }
    },
  );

  function clearFilters(): void {
    filters.clear();
    props.onQueryChange?.("");
  }
  const selectedId = () => props.selected?.id ?? null;
  const current = () => sounds().find((sound) => sound.id === selectedId()) ?? null;

  // Set by a step, so the selection it makes takes focus with it (#880).
  let focusFollows = false;

  /** Select the neighbouring sound, which auditions it; the ends hold. */
  function step(direction: 1 | -1): void {
    const from = current();
    const target = (direction === 1 ? nextIn : previousIn)(sounds(), from);
    if (!target) return;
    if (target === from) {
      // At an end there is nothing new to hear, but focus still joins the row.
      revealSelectedRow(list, true);
      return;
    }
    focusFollows = true;
    void browser.audition(target);
  }

  const shelfKeys: Partial<Record<SoundsKeyAction, () => void>> = {
    "library.pick_all": () => shelf.pick(0),
    "library.category_next": () => shelf.stepRole(1),
    "library.category_previous": () => shelf.stepRole(-1),
    "library.family_next": () => shelf.stepFamily(1),
    "library.family_previous": () => shelf.stepFamily(-1),
  };

  /** Select and audition a random sound from the list in view. */
  function shuffle(): void {
    const pool = sounds();
    if (pool.length > 0)
      void browser.audition(pool[Math.floor(Math.random() * pool.length)]);
  }

  function press(action: SoundsKeyAction): void {
    const sound = current();
    if (shelfKeys[action]) shelfKeys[action]?.();
    else if (action === "library.shuffle") shuffle();
    else if (action === "library.genre_menu") setGenreMenuOpen((open) => !open);
    else if (action === "library.loop_tempo" && family() === "loops")
      filters.toggleTempo();
    else if (action === "library.select_next") step(1);
    else if (action === "library.select_previous") step(-1);
    else if (action === "library.audition" && sound) void browser.audition(sound);
    else if (action === "library.similar" && sound) props.onSimilar(sound);
  }

  onSettled(() => {
    props.onKeys(press);
    props.onCloseMenu?.(closeGenreMenu);
    props.onAuditioner?.((asset) => void browser.audition(asset));
    return () => {
      props.onKeys(null);
      props.onCloseMenu?.(null);
      props.onAuditioner?.(null);
    };
  });

  // The list's name, as similar sounds' back button reads it.
  const listLabel = (): string => {
    if (props.packSlug) return typed()[0]?.packName ?? "Pack";
    const { family: shelfFamily, role } = shelf.selection();
    return role ? groupLabel(shelfFamily, role, false) : allLabel(shelfFamily);
  };
  createEffect(listLabel, (label) => {
    props.onListLabel?.(label);
  });

  // Keep the heard row on screen, and focused when a step chose it.
  createEffect(selectedId, () => {
    revealSelectedRow(list, focusFollows);
    focusFollows = false;
  });
  const tabStop = createMemo(() =>
    tabStopId(
      sounds().map((sound) => sound.id),
      selectedId(),
    ),
  );

  // A pack that would not load is named as missing; the others still list.
  const failedPacks = () =>
    browser
      .packs()
      .filter((pack) => browser.packErrors().some((e) => e.packSlug === pack.slug));

  return (
    <section class="sounds-view" aria-label="Browse sounds">
      <h2 class="visually-hidden">{props.heading ?? "Library"}</h2>
      <Show
        when={browser.indexError() === null}
        fallback={
          <div class="sounds-error" role="alert">
            <HiSolidExclamationTriangle size={16} />{" "}
            {LOAD_REASON_LABELS[browser.indexError() ?? "network"]}{" "}
            <button type="button" class="sounds-retry" onClick={() => void load()}>
              Retry
            </button>
          </div>
        }
      >
        <Show
          when={ready()}
          fallback={
            <Show when={loaderShown}>
              <TapeLoader label="Loading library" />
            </Show>
          }
        >
          <Show when={failedPacks().length > 0}>
            <div class="sounds-notice" role="alert">
              {failedPacks().length === 1 ? "A pack is" : "Some packs are"} unavailable.
              The others still work.{" "}
              <button
                type="button"
                class="sounds-retry"
                onClick={() =>
                  failedPacks().forEach((pack) => void browser.retryPack(pack))
                }
              >
                Retry
              </button>
            </div>
          </Show>
          <Show when={shelf.families().length > 0}>
            <Shelf
              families={shelf.families()}
              family={family()}
              roles={shelf.roles()}
              role={shelf.selection().role}
              keyLabel={props.keyLabel}
              onFamily={shelf.setFamily}
              onRole={shelf.setRole}
            />
          </Show>
          <Show when={jumps().length > 0}>
            <div class="role-jumps">
              <span class="filter-label">Categories</span>
              <For each={jumps()}>
                {(jump) => (
                  <button
                    type="button"
                    class="shelf-chip"
                    onClick={() => {
                      shelf.select(jump.family, jump.role);
                      props.onQueryChange?.("");
                    }}
                  >
                    {jump.label} →
                  </button>
                )}
              </For>
            </div>
          </Show>
          <FilterRow
            genres={genres()}
            selectedGenres={filters.genres()}
            menuOpen={genreMenuOpen()}
            loops={family() === "loops"}
            tempo={filters.tempo()}
            songBpm={props.songBpm ?? 120}
            bars={filters.bars()}
            count={sounds().length}
            keyLabel={props.keyLabel}
            onMenuOpen={setGenreMenuOpen}
            genreButtonRef={(button) => {
              genreButton = button;
            }}
            onGenre={filters.toggleGenre}
            onClearGenres={() => {
              filters.clearGenres();
              setGenreMenuOpen(false);
            }}
            onTempo={filters.setTempo}
            onBars={filters.setBars}
          />
          <Show
            when={sounds().length > 0}
            fallback={
              <div class="sounds-empty">
                <p>No sounds match these filters.</p>
                <Show when={narrowed()}>
                  <button type="button" onClick={() => clearFilters()}>
                    Clear the filters
                  </button>
                </Show>
              </div>
            }
          >
            <ul class="sounds-list" aria-label="Sounds" ref={list}>
              <For each={sounds()}>
                {(asset) => (
                  <SoundRow
                    asset={asset}
                    selected={selectedId() === asset.id}
                    tabbable={tabStop() === asset.id}
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
