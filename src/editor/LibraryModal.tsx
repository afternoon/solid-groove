import { For, type JSX, Show } from "@solidjs/web";
import { createMemo, createSignal, onSettled } from "solid-js";
import type { Analytics } from "../analytics/analytics";
import Dialog from "../components/Dialog";
import type { PreviewEngine } from "../library/audition";
import { LibraryClient } from "../library/libraryClient";
import type {
  LibraryAsset,
  LibraryAssetType,
  LibraryPackSummary,
} from "../library/manifest";
import PackBanner from "../library/PackBanner";
import PacksView from "../library/PacksView";
import SoundsView from "../library/SoundsView";
import type { SoundsKeyAction } from "../library/soundKeys";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { ariaBool } from "../shared/aria";
import type { ShortcutActionId } from "../shortcuts";
import "./LibraryModal.css";

/** What the rail can show. Only `all` is built; the rest are placeholders for later parts. */
export type LibraryView = "packs" | "all" | "favourites" | "recent";

interface RailItem {
  readonly id: LibraryView;
  readonly label: string;
  /** The registry action whose key badges the item; unset means it has no key. */
  readonly action?: ShortcutActionId;
}

const PLACES: readonly RailItem[] = [
  { id: "packs", label: "Browse packs", action: "library.browse_packs" },
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
  /** `1`-`9`: open that pack over the grid of packs, else pick that category. */
  pick(n: number): void;
  /** Back out of an opened pack, then out of Browse packs. */
  back(): void;
}

export interface LibraryModalProps {
  readonly client?: LibraryClient;
  /** Built once per open by the host: a disposed engine stays disposed. */
  readonly previewEngine: PreviewEngine;
  readonly analytics?: Analytics;
  /** Insert the chosen sound. The host closes this on the way through. */
  onInsert(asset: LibraryAsset): void;
  readonly addedPackIds: readonly string[];
  /** Restrict to these asset types — the Loop button opens it on loops. */
  readonly assetTypes?: readonly LibraryAssetType[];
  readonly heading?: string;
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
  onShowKeys?(): void;
  /** Opens similar sounds for a row (part 12 wires this). */
  onSimilar?(asset: LibraryAsset): void;
  onActions?(actions: LibraryActions | null): void;
  onClose(): void;
}

function Key(props: { label?: string }): JSX.Element {
  return (
    <Show when={props.label}>
      <kbd class="library-modal-key">{props.label}</kbd>
    </Show>
  );
}

/**
 * The library window (`UI-001`, `LIB-010`): a header naming the slot with
 * **Was** and **Hearing** readouts, a rail of places to look, and a footer with
 * one large Insert button. Hearing a sound selects it and inserting is a second
 * step, so browsing never edits the project. Views other than All sounds are
 * placeholders until they land. `EditorView` hands it the `dialog` and
 * `library` shortcut contexts.
 */
export default function LibraryModal(props: LibraryModalProps): JSX.Element {
  const [view, setView] = createSignal<LibraryView>("all");
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal<LibraryAsset | null>(null);
  // The pack whose sounds the sounds view is scoped to (`null`: no scope). The
  // sounds view reads this; Browse packs and In this project set it.
  const [packScope, setPackScope] = createSignal<string | null>(null);
  let openNthPack: ((n: number) => void) | null = null;
  const client = props.client ?? new LibraryClient();
  const showsPacks = createMemo(() => view() === "packs" && packScope() === null);
  const showsSounds = createMemo(() => view() === "all" || packScope() !== null);
  // The rail's *In this project*: the project's pack dependencies and shelf.
  const [indexed, setIndexed] = createSignal<readonly LibraryPackSummary[]>([]);
  const projectPacks = createMemo(() =>
    indexed().filter((pack) => props.addedPackIds.includes(pack.id)),
  );

  function showView(next: LibraryView): void {
    setPackScope(null);
    setView(next);
  }

  /** Back: out of an opened pack, then out of the grid of packs. */
  function back(): void {
    if (packScope() !== null) setPackScope(null);
    else if (view() === "packs") setView("all");
  }

  /** A digit opens a pack over the grid, and picks a category over sounds. */
  function pick(n: number): void {
    if (showsPacks()) openNthPack?.(n);
    else if (showsSounds()) soundsKeys?.(`library.pick_${n}` as SoundsKeyAction);
  }
  const keyOf = (action?: ShortcutActionId) =>
    action ? props.keyLabel?.(action) : undefined;

  let soundsKeys: ((action: SoundsKeyAction) => void) | null = null;

  function press(action: ShortcutActionId): void {
    if (action === "library.search") {
      document.querySelector<HTMLInputElement>(".library-modal-search")?.focus();
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
    const digit = /^library\.pick_(\d)$/.exec(action)?.[1];
    if (digit) pick(Number(digit));
    else if (showsSounds()) soundsKeys?.(action as SoundsKeyAction);
  }

  function insertSelected(): boolean {
    const asset = selected();
    if (!asset) return false;
    props.onInsert(asset);
    return true;
  }

  onSettled(() => {
    void client.loadIndex().then(setIndexed, () => {});
    props.onActions?.({ showView, insertSelected, press, pick, back });
    return () => props.onActions?.(null);
  });

  function RailButton(railProps: { item: RailItem }): JSX.Element {
    return (
      <button
        type="button"
        class="library-modal-rail-item"
        aria-pressed={ariaBool(view() === railProps.item.id)}
        onClick={() => showView(railProps.item.id)}
      >
        {railProps.item.label}
        <Key label={keyOf(railProps.item.action)} />
      </button>
    );
  }

  return (
    <Dialog
      label="Library"
      size="modal"
      flush
      onClose={() => props.onClose()}
      header={
        <div class="library-modal-head">
          <span
            class="library-modal-bar"
            style={{ background: props.trackColor ?? "var(--color-accent)" }}
          />
          <b class="library-modal-slot">{props.slot ?? props.heading ?? "Library"}</b>
          <div class="library-modal-readout">
            <span class="library-modal-label">Was</span>
            <b>{props.current ?? "Empty"}</b>
          </div>
          <div class="library-modal-readout">
            <span class="library-modal-label">Hearing</span>
            <b>{selected()?.name ?? "Nothing yet"}</b>
          </div>
          <input
            type="search"
            class={["library-modal-search", MASK_CONTENT]}
            placeholder="Search sounds, packs and categories"
            aria-label="Search sounds"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
      }
      footer={
        <>
          <span class="library-modal-hint">
            {selected() ? "Enter inserts it" : "Pick a sound to hear it"}
          </span>
          <button
            type="button"
            class="library-modal-ghost"
            aria-label="Keyboard shortcuts"
            onClick={() => props.onShowKeys?.()}
          >
            <Key label={keyOf("help.shortcut_guide")} />
          </button>
          <button
            type="button"
            class="library-modal-ghost"
            disabled={!showsSounds()}
            onClick={() => press("library.shuffle")}
          >
            Shuffle <Key label={keyOf("library.shuffle")} />
          </button>
          <button
            type="button"
            class="library-modal-insert"
            disabled={selected() === null}
            aria-keyshortcuts="Enter"
            onClick={() => insertSelected()}
          >
            {selected() ? `Insert ${selected()?.name}` : "Insert"}
          </button>
        </>
      }
    >
      <div class="library-modal-body">
        <nav class="library-modal-rail" aria-label="Places">
          <For each={PLACES}>{(item) => <RailButton item={item} />}</For>
          <fieldset class="library-modal-rail-group">
            <legend class="library-modal-label">In this project</legend>
            <For each={projectPacks()}>
              {(pack) => (
                <button
                  type="button"
                  class="library-modal-rail-item"
                  aria-pressed={ariaBool(packScope() === pack.slug)}
                  onClick={() => setPackScope(pack.slug)}
                >
                  {pack.name}
                  <small>{pack.assetCount}</small>
                </button>
              )}
            </For>
          </fieldset>
          <RailButton item={RECENT} />
        </nav>
        <div class="library-modal-main">
          <Show when={packScope()}>
            {(slug) => (
              <PackBanner
                client={client}
                slug={slug()}
                projectPackIds={props.addedPackIds}
              />
            )}
          </Show>
          <Show when={showsPacks()}>
            <PacksView
              client={client}
              previewEngine={props.previewEngine}
              analytics={props.analytics}
              projectPackIds={props.addedPackIds}
              keyLabel={props.keyLabel}
              onOpenPack={setPackScope}
              onRegisterOpenNth={(open) => {
                openNthPack = open;
              }}
            />
          </Show>
          {/* Stays mounted while another place shows, so leaving and coming back
              keeps its audition engine, which it disposes with the window. */}
          <div class="library-modal-sounds" hidden={!showsSounds()}>
            <SoundsView
              client={client}
              previewEngine={props.previewEngine}
              analytics={props.analytics}
              assetTypes={props.assetTypes}
              heading={props.heading}
              trackColor={props.trackColor}
              selected={selected()}
              onSelect={setSelected}
              onSimilar={(asset) => props.onSimilar?.(asset)}
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
          <Show when={view() === "favourites" || view() === "recent"}>
            <p class="library-modal-empty">
              {(view() === "recent" ? RECENT : PLACES[2]).label} will appear here.
            </p>
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
