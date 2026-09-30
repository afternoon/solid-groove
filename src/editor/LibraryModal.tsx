import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";
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
import "./LibraryModal.css";

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
  onShowKeys?(): void;
  onClose(): void;
}

/**
 * The library window (`UI-001`, `LIB-010`): a header naming the slot with
 * **Was** and **Hearing** readouts, and a footer with one large Insert button.
 * Hearing a sound selects it and inserting is a second step, so browsing never
 * edits the project.
 */
export default function LibraryModal(props: LibraryModalProps): JSX.Element {
  const [selected, setSelected] = createSignal<LibraryAsset | null>(null);

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
            class="library-modal-search"
            placeholder="Search sounds, packs and categories"
            aria-label="Search the library"
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
            aria-label="Keyboard shortcuts"
            onClick={() => props.onShowKeys?.()}
          >
            ?
          </button>
          <button type="button" disabled>
            Shuffle
          </button>
          <button
            type="button"
            class="library-modal-insert"
            disabled={selected() === null}
            aria-keyshortcuts="Enter"
            onClick={() => {
              const asset = selected();
              if (asset) props.onInsert(asset);
            }}
          >
            {selected() ? `Insert ${selected()?.name}` : "Insert"}
          </button>
        </>
      }
    >
      <div class="library-modal-body">
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
      </div>
    </Dialog>
  );
}
