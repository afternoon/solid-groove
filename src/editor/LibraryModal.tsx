import { For, type JSX, Match, Show, Switch } from "@solidjs/web";
import { createSignal, onSettled } from "solid-js";
import type { Analytics } from "../analytics/analytics";
import Dialog from "../components/Dialog";
import type { PreviewEngine } from "../library/audition";
import type { LibraryClient } from "../library/libraryClient";
import type {
  LibraryAsset,
  LibraryAssetType,
  LibraryPackSummary,
} from "../library/manifest";
import SoundsView from "../library/SoundsView";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { ariaBool } from "../shared/aria";
import type { ShortcutActionId } from "../shortcuts";
import "./LibraryModal.css";

/** What the rail can show. Only `all` is built; the rest are placeholders for later parts. */
export type LibraryView = "packs" | "all" | "favourites" | "project" | "recent";

interface RailItem {
  readonly id: LibraryView;
  readonly label: string;
  /** The registry action whose key badges the item; unset means it has no key. */
  readonly action?: ShortcutActionId;
}

const RAIL: readonly RailItem[] = [
  { id: "packs", label: "Browse packs", action: "library.browse_packs" },
  { id: "all", label: "All sounds", action: "library.all_sounds" },
  { id: "favourites", label: "Favourites", action: "library.favourites" },
  { id: "project", label: "In this project" },
  { id: "recent", label: "Recently viewed" },
];

/**
 * What the `library` shortcut context drives. The host (`EditorView`) holds
 * these and registers the registry's `library.*` actions against them, so the
 * modal never listens for a key itself.
 */
export interface LibraryActions {
  showView(view: LibraryView): void;
  insertSelected(): boolean;
}

export interface LibraryModalProps {
  readonly client?: LibraryClient;
  /** Built once per open by the host: a disposed engine stays disposed. */
  readonly previewEngine: PreviewEngine;
  readonly analytics?: Analytics;
  /** Insert the chosen sound. The host closes this on the way through. */
  onInsert(asset: LibraryAsset): void;
  readonly addedPackIds: readonly string[];
  onAddPack(pack: LibraryPackSummary): void;
  onPackBrowserOpenChange(open: boolean): void;
  /** Restrict to these asset types — the Loop button opens it on loops. */
  readonly assetTypes?: readonly LibraryAssetType[];
  readonly heading?: string;
  readonly slot?: string;
  readonly trackColor?: string;
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
  const keyOf = (action?: ShortcutActionId) =>
    action ? props.keyLabel?.(action) : undefined;

  function insertSelected(): boolean {
    const asset = selected();
    if (!asset) return false;
    props.onInsert(asset);
    return true;
  }

  onSettled(() => {
    props.onActions?.({ showView: setView, insertSelected });
    return () => props.onActions?.(null);
  });

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
          <button type="button" class="library-modal-ghost" disabled>
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
          <For each={RAIL}>
            {(item) => (
              <button
                type="button"
                class="library-modal-rail-item"
                aria-pressed={ariaBool(view() === item.id)}
                onClick={() => setView(item.id)}
              >
                {item.label}
                <Key label={keyOf(item.action)} />
              </button>
            )}
          </For>
        </nav>
        <div class="library-modal-main">
          <Switch>
            <Match when={view() === "all"}>
              <SoundsView
                client={props.client}
                previewEngine={props.previewEngine}
                analytics={props.analytics}
                assetTypes={props.assetTypes}
                heading={props.heading}
                trackColor={props.trackColor}
                selected={selected()}
                onSelect={setSelected}
                onSimilar={(asset) => props.onSimilar?.(asset)}
                query={query()}
              />
            </Match>
            <Match when={true}>
              <p class="library-modal-empty">
                {RAIL.find((item) => item.id === view())?.label} will appear here.
              </p>
            </Match>
          </Switch>
        </div>
      </div>
    </Dialog>
  );
}
