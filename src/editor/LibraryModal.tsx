import { For, type JSX, Match, Switch } from "@solidjs/web";
import { createSignal, onSettled } from "solid-js";
import type { Analytics } from "../analytics/analytics";
import Dialog from "../components/Dialog";
import type { PreviewEngine } from "../library/audition";
import LibraryBrowser from "../library/LibraryBrowser";
import type { LibraryClient } from "../library/libraryClient";
import type {
  LibraryAsset,
  LibraryAssetType,
  LibraryPackSummary,
} from "../library/manifest";
import { ariaBool } from "../shared/aria";
import "./LibraryModal.css";

/** The library's three views. Sounds is the working one; the others are filled in later. */
export type LibraryView = "sounds" | "packs" | "favourites";

const VIEWS: readonly { id: LibraryView; label: string }[] = [
  { id: "sounds", label: "Sounds" },
  { id: "packs", label: "Packs" },
  { id: "favourites", label: "Favourites" },
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
  readonly current?: string | null;
  onActions?(actions: LibraryActions | null): void;
  onClose(): void;
}

/**
 * The library window (`UI-001`, `LIB-010`): a header naming the slot and what
 * it holds, a Sounds / Packs / Favourites switch, and one large Insert button.
 * Hearing a sound selects it and inserting is a second step, so browsing never
 * edits the project. Packs and Favourites are placeholders until they land.
 * `EditorView` hands it the `dialog` and `library` shortcut contexts.
 */
export default function LibraryModal(props: LibraryModalProps): JSX.Element {
  const [view, setView] = createSignal<LibraryView>("sounds");
  const [selected, setSelected] = createSignal<LibraryAsset | null>(null);

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
      size="jumbo"
      flush
      onClose={() => props.onClose()}
      header={
        <div class="library-modal-head">
          <div class="library-modal-slot">
            <span class="library-modal-label">{props.slot ?? "Slot"}</span>
            <b>{props.heading ?? "Library"}</b>
          </div>
          <div class="library-modal-slot">
            <span class="library-modal-label">Now</span>
            <b>{props.current ?? "Empty"}</b>
          </div>
          <div class="library-modal-views" role="tablist" aria-label="Library views">
            <For each={VIEWS}>
              {(entry) => (
                <button
                  type="button"
                  role="tab"
                  class="library-modal-view"
                  aria-selected={ariaBool(view() === entry.id)}
                  onClick={() => setView(entry.id)}
                >
                  {entry.label}
                </button>
              )}
            </For>
          </div>
        </div>
      }
      footer={
        <>
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
        <Switch>
          <Match when={view() === "sounds"}>
            <LibraryBrowser
              client={props.client}
              previewEngine={props.previewEngine}
              analytics={props.analytics}
              onInsert={(asset) => props.onInsert(asset)}
              onSelect={setSelected}
              addedPackIds={props.addedPackIds}
              onAddPack={(pack) => props.onAddPack(pack)}
              onPackBrowserOpenChange={(open) => props.onPackBrowserOpenChange(open)}
              assetTypes={props.assetTypes}
              heading={props.heading}
            />
          </Match>
          <Match when={view() === "packs"}>
            <p class="library-modal-empty">Packs will appear here.</p>
          </Match>
          <Match when={view() === "favourites"}>
            <p class="library-modal-empty">Sounds you like will appear here.</p>
          </Match>
        </Switch>
      </div>
    </Dialog>
  );
}
