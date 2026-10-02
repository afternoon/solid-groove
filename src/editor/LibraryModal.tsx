import { For, type JSX, Show } from "@solidjs/web";
import { createMemo, createSignal, onSettled } from "solid-js";
import type { Analytics } from "../analytics/analytics";
import { loadEveryAsset } from "../library/allAssets";
import type { PreviewEngine } from "../library/audition";
import { LibraryClient } from "../library/libraryClient";
import type {
  LibraryAsset,
  LibraryAssetType,
  LibraryPackSummary,
} from "../library/manifest";
import PackBanner from "../library/PackBanner";
import PacksView from "../library/PacksView";
import SimilarSoundsView from "../library/SimilarSoundsView";
import SoundsView from "../library/SoundsView";
import { type SlotAudition, slotPreviewEngine } from "../library/slotAudition";
import type { SoundsKeyAction } from "../library/soundKeys";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { ariaBool } from "../shared/aria";
import type { ShortcutActionId } from "../shortcuts";
import LibraryHint, { type LibraryPlace } from "./LibraryHint";
import LibraryKeys from "./LibraryKeys";
import { ClearIcon, DiceIcon, GridIcon, SearchIcon } from "./libraryIcons";
import ViewFrame from "./ViewFrame";
import "./LibraryModal.css";

/** What the rail can show. Only `all` is built; the rest are placeholders for later parts. */
export type LibraryView = "packs" | "all" | "favourites" | "recent";

interface RailItem {
  readonly id: LibraryView;
  readonly label: string;
  /** The registry action whose key badges the item; unset means it has no key. */
  readonly action?: ShortcutActionId;
}

/** Browse packs stands apart from the places below it, as its own button. */
const BROWSE: RailItem = {
  id: "packs",
  label: "Browse packs",
  action: "library.browse_packs",
};

const PLACES: readonly RailItem[] = [
  { id: "all", label: "All sounds", action: "library.all_sounds" },
  { id: "favourites", label: "Favourites", action: "library.favourites" },
];

/** Recently viewed sits below the project's packs, so it is not in `PLACES`. */
const RECENT: RailItem = { id: "recent", label: "Recently viewed" };

/**
 * What the `library` shortcut context drives. The host (`EditorView`) holds
 * these and registers the registry's `library.*` actions against them, so the
 * modal never listens for a key itself.
 */
export interface LibraryActions {
  showView(view: LibraryView): void;
  insertSelected(): boolean;
  /** Runs a `library.*` key on the visible view, which knows what it means. */
  press(action: ShortcutActionId): void;
  /** Open similar sounds for the selected sound; false when none is selected. */
  similar(): boolean;
  /**
   * Back out of the innermost sub-view: similar sounds, then an opened pack,
   * then Browse packs. False when there was none to leave.
   */
  back(): boolean;
  /** `?`: open or close the sheet of the library's own keys. */
  toggleKeys(): void;
  /** Close that sheet; false when it was not open, so Escape leaves the view. */
  closeKeys(): boolean;
}

export interface LibraryModalProps {
  readonly client?: LibraryClient;
  /** Built once per open by the host: a disposed engine stays disposed. */
  readonly previewEngine: PreviewEngine;
  /**
   * The slot's hot-swap (LIB-010): when given, every audition is heard in the
   * slot, in the beat, and closing the window puts the slot's own sound back.
   */
  readonly slotAudition?: SlotAudition;
  readonly analytics?: Analytics;
  /** Insert the chosen sound. The host closes this on the way through. */
  onInsert(asset: LibraryAsset): void;
  readonly addedPackIds: readonly string[];
  /** Restrict to these asset types — the Loop button opens it on loops. */
  readonly assetTypes?: readonly LibraryAssetType[];
  readonly heading?: string;
  /** What inserting fills, as a path: "BD › Drum machine › BD" (`UI-002`). */
  readonly path?: string;
  /** The slot's own name, for the footer's hint: a pad's name. */
  readonly slot?: string;
  readonly trackColor?: string;
  /** What the library opens for, so the shelf can open on the slot's family. */
  readonly slotKind?: "drum-pad" | "sampler" | "loop-track";
  /** The storage ref of the sound a drum pad holds, to open on its role. */
  readonly currentRef?: string | null;
  /** The song's tempo, for the loop Tempo filter's "near". */
  readonly songBpm?: number;
  /** The sound the slot holds now. */
  readonly current?: string | null;
  /** Key badge text for a registry action, from the registry, never hard-coded. */
  keyLabel?(action: ShortcutActionId): string;
  onActions?(actions: LibraryActions | null): void;
}

/** A boxed key badge. `hidden` when its control already names its key. */
function Key(props: { label?: string; hidden?: boolean }): JSX.Element {
  return (
    <Show when={props.label}>
      <kbd class="library-modal-key" aria-hidden={props.hidden ? "true" : undefined}>
        {props.label}
      </kbd>
    </Show>
  );
}

/** Where a slot's auditions are heard, for the footer's hint. */
function slotPlace(kind: LibraryModalProps["slotKind"], slot?: string): string {
  if (kind === "drum-pad") return `the ${slot ?? "drum"} pad`;
  return kind === "loop-track" ? "the loop track" : "the sampler";
}

/**
 * The library window (`UI-001`, `LIB-010`): a header naming what it inserts
 * into (`UI-002`) with **In the slot** and **Hearing** readouts, a rail of places to look, and a footer with
 * one large Insert button. Hearing a sound selects it and inserting is a second
 * step, so browsing never edits the project. Views other than All sounds are
 * placeholders until they land. It is the view on `4` (`UI-002`), not a
 * window: `EditorView` hands it the `library` shortcut context.
 */
export default function LibraryModal(props: LibraryModalProps): JSX.Element {
  const [view, setView] = createSignal<LibraryView>("all");
  const [query, setQuery] = createSignal("");
  const [keysOpen, setKeysOpen] = createSignal(false);
  const [selected, setSelected] = createSignal<LibraryAsset | null>(null);
  // Every view auditions through this one engine, so each is heard in the slot.
  const previewEngine = props.slotAudition
    ? slotPreviewEngine(props.previewEngine, props.slotAudition, selected)
    : props.previewEngine;
  // The pack whose sounds the sounds view is scoped to (`null`: no scope). The
  // sounds view reads this; Browse packs and In this project set it.
  const [packScope, setPackScope] = createSignal<string | null>(null);
  const client = props.client ?? new LibraryClient();
  // Similar sounds swaps in over whichever place opened it.
  const [similarOf, setSimilarOf] = createSignal<LibraryAsset | null>(null);
  // What the sounds list in view is called, so similar sounds' way back names it.
  const [listLabel, setListLabel] = createSignal<string | undefined>(undefined);
  const [everyAsset, setEveryAsset] = createSignal<readonly LibraryAsset[]>([]);
  const showsPacks = createMemo(
    () => similarOf() === null && view() === "packs" && packScope() === null,
  );
  const showsSounds = createMemo(
    () => similarOf() === null && (view() === "all" || packScope() !== null),
  );
  // The rail's *In this project*: the project's pack dependencies and shelf.
  const [indexed, setIndexed] = createSignal<readonly LibraryPackSummary[]>([]);
  const [indexFailed, setIndexFailed] = createSignal(false);
  const projectPacks = createMemo(() =>
    indexed().filter((pack) => props.addedPackIds.includes(pack.id)),
  );

  function showView(next: LibraryView): void {
    setSimilarOf(null);
    setPackScope(null);
    setView(next);
  }

  /** Swap the main area to the similar-sounds view for `asset`. */
  function openSimilar(asset: LibraryAsset): void {
    setSimilarOf(asset);
    void loadEveryAsset(client).then(setEveryAsset, () => setEveryAsset([]));
  }

  function similar(): boolean {
    const asset = selected();
    if (!asset || similarOf()) return false;
    openSimilar(asset);
    return true;
  }

  /** Back: out of similar sounds, then an opened pack, then the grid of packs. */
  function back(): boolean {
    if (similarOf() !== null) setSimilarOf(null);
    else if (packScope() !== null) setPackScope(null);
    else if (view() === "packs") setView("all");
    else return false;
    return true;
  }

  const keyOf = (action?: ShortcutActionId) =>
    action ? props.keyLabel?.(action) : undefined;

  let soundsKeys: ((action: SoundsKeyAction) => void) | null = null;

  // Looked up rather than held by `ref`: the dialog reads its header prop more
  // than once, so a ref can end up naming a copy that never mounted.
  const focusSearch = () =>
    document.querySelector<HTMLInputElement>(".library-modal-search")?.focus();

  function press(action: ShortcutActionId): void {
    if (action === "library.search") {
      focusSearch();
      return;
    }
    // Down is how a producer leaves the search field for the list.
    const active = document.activeElement;
    if (
      action === "library.select_next" &&
      active instanceof HTMLInputElement &&
      active.type === "search"
    ) {
      active.blur();
    }
    if (showsSounds()) soundsKeys?.(action as SoundsKeyAction);
  }

  function toggleKeys(): void {
    setKeysOpen((open) => !open);
  }

  function closeKeys(): boolean {
    if (!keysOpen()) return false;
    setKeysOpen(false);
    return true;
  }

  function clearSearch(): void {
    setQuery("");
    focusSearch();
  }

  function insertSelected(): boolean {
    const asset = selected();
    if (!asset) return false;
    props.onInsert(asset);
    return true;
  }

  onSettled(() => {
    void client.loadIndex().then(setIndexed, () => setIndexFailed(true));
    props.onActions?.({
      showView,
      insertSelected,
      press,
      similar,
      back,
      toggleKeys,
      closeKeys,
    });
    return () => {
      props.onActions?.(null);
      // Leaving the view ends here: the slot plays its own sound again.
      props.slotAudition?.clear();
    };
  });

  // An opened pack is where you are, so the place that opened it is not.
  const isCurrent = (id: LibraryView) => view() === id && packScope() === null;
  const place = (): LibraryPlace =>
    similarOf() ? "similar" : showsPacks() ? "packs" : showsSounds() ? "sounds" : "other";

  function RailButton(railProps: { item: RailItem; browse?: boolean }): JSX.Element {
    return (
      <button
        type="button"
        class={railProps.browse ? "library-modal-browse" : "library-modal-rail-item"}
        aria-current={isCurrent(railProps.item.id) ? "true" : undefined}
        onClick={() => showView(railProps.item.id)}
      >
        <Show when={railProps.browse}>
          <GridIcon />
        </Show>
        <span>{railProps.item.label}</span>
        <Key label={keyOf(railProps.item.action)} />
      </button>
    );
  }

  return (
    <ViewFrame
      label="Library"
      class="library-view"
      header={
        <div class="library-modal-head">
          <span
            class="library-modal-bar"
            style={{ background: props.trackColor ?? "var(--color-accent)" }}
          />
          {/* A track's and a pad's names are the user's (ADR 0002). */}
          <h2 class={["library-modal-slot", MASK_CONTENT]}>
            <span class="library-modal-label">Inserting into </span>
            <b>{props.path ?? props.heading ?? "Library"}</b>
          </h2>
          <fieldset class="library-modal-readout">
            <legend class="library-modal-label">In the slot</legend>
            <b>{props.current ?? "Empty"}</b>
          </fieldset>
          <fieldset class="library-modal-readout">
            <legend class="library-modal-label">Hearing</legend>
            <b>{selected()?.name ?? "Nothing yet"}</b>
          </fieldset>
          <label class="library-modal-find">
            <SearchIcon />
            <input
              type="search"
              class={["library-modal-search", MASK_CONTENT]}
              placeholder="Search sounds, packs and categories"
              aria-label="Search sounds"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <Show when={query()}>
              <button
                type="button"
                class="library-modal-clear"
                aria-label="Clear search"
                onClick={clearSearch}
              >
                <ClearIcon />
              </button>
            </Show>
          </label>
        </div>
      }
      footer={
        <>
          <LibraryHint
            place={place()}
            where={props.slotAudition && slotPlace(props.slotKind, props.slot)}
            current={props.current}
            selected={selected()?.name}
            keyLabel={props.keyLabel}
          />
          <button
            type="button"
            class="library-modal-ghost"
            aria-label="Keyboard shortcuts"
            aria-expanded={ariaBool(keysOpen())}
            onClick={toggleKeys}
          >
            <Key label={keyOf("help.shortcut_guide")} />
          </button>
          <button
            type="button"
            class="library-modal-ghost"
            disabled={!showsSounds()}
            onClick={() => press("library.shuffle")}
          >
            <DiceIcon />
            Shuffle <Key label={keyOf("library.shuffle")} />
          </button>
          <button
            type="button"
            class="library-modal-insert"
            disabled={selected() === null}
            aria-keyshortcuts="Enter"
            onClick={() => insertSelected()}
          >
            <span>{selected() ? `Insert ${selected()?.name}` : "Insert"}</span>
            <Key label={keyOf("library.insert")} hidden />
          </button>
        </>
      }
    >
      <Show when={keysOpen()}>
        <LibraryKeys onClose={() => setKeysOpen(false)} />
      </Show>
      <div class="library-modal-body">
        <nav class="library-modal-rail" aria-label="Places">
          <RailButton item={BROWSE} browse />
          <For each={PLACES}>{(item) => <RailButton item={item} />}</For>
          <fieldset class="library-modal-rail-group">
            <legend class="library-modal-label library-modal-rule">
              In this project
            </legend>
            <For each={projectPacks()}>
              {(pack) => (
                <button
                  type="button"
                  class="library-modal-rail-item"
                  aria-pressed={ariaBool(packScope() === pack.slug)}
                  onClick={() => setPackScope(pack.slug)}
                >
                  <span>{pack.name}</span>
                  <small>{pack.assetCount}</small>
                </button>
              )}
            </For>
            <Show when={indexFailed()}>
              <p class="library-modal-rail-note">Packs couldn't load.</p>
            </Show>
          </fieldset>
          <RailButton item={RECENT} />
        </nav>
        <div class="library-modal-main">
          <Show when={similarOf()}>
            {(reference) => (
              <SimilarSoundsView
                reference={reference()}
                library={everyAsset()}
                previewEngine={previewEngine}
                trackColor={props.trackColor}
                onSelect={setSelected}
                onBack={back}
                backLabel={listLabel()}
              />
            )}
          </Show>
          <Show when={similarOf() === null && packScope()}>
            {(slug) => (
              <PackBanner
                client={client}
                slug={slug()}
                projectPackIds={props.addedPackIds}
                onClose={() => setPackScope(null)}
              />
            )}
          </Show>
          <Show when={showsPacks()}>
            <PacksView
              client={client}
              previewEngine={previewEngine}
              analytics={props.analytics}
              projectPackIds={props.addedPackIds}
              keyLabel={props.keyLabel}
              onOpenPack={setPackScope}
            />
          </Show>
          {/* Stays mounted while another place shows, so leaving and coming back
              keeps its audition engine, which it disposes with the window. */}
          <div class="library-modal-sounds" hidden={!showsSounds()}>
            <SoundsView
              client={client}
              previewEngine={previewEngine}
              analytics={props.analytics}
              assetTypes={props.assetTypes}
              heading={props.heading}
              trackColor={props.trackColor}
              selected={selected()}
              onSelect={setSelected}
              onSimilar={openSimilar}
              onListLabel={setListLabel}
              query={query()}
              onQueryChange={setQuery}
              packSlug={packScope()}
              songBpm={props.songBpm}
              slot={props.slotKind && { kind: props.slotKind, ref: props.currentRef }}
              keyLabel={props.keyLabel}
              onKeys={(handler) => {
                soundsKeys = handler;
              }}
            />
          </div>
          <Show
            when={
              similarOf() === null && (view() === "favourites" || view() === "recent")
            }
          >
            <p class="library-modal-empty">
              {(view() === "recent" ? RECENT : PLACES[1]).label} will appear here.
            </p>
          </Show>
        </div>
      </div>
    </ViewFrame>
  );
}
