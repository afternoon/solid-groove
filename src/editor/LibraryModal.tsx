import type { JSX } from "@solidjs/web";
import { onSettled } from "solid-js";
import type { Analytics } from "../analytics/analytics";
import type { PreviewEngine } from "../library/audition";
import LibraryBrowser from "../library/LibraryBrowser";
import type { LibraryClient } from "../library/libraryClient";
import type { LibraryAsset, LibraryPackSummary } from "../library/manifest";
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
  onClose(): void;
}

/**
 * The library, as a window you open from a slot (`UI-001`).
 *
 * It used to be a narrow column pinned open beside the arrangement, which cost
 * the timeline a fifth of the width for the whole session in exchange for a
 * tree you look at for a few seconds at a time. Opening it from the slot it is
 * going to fill inverts that: the arrangement gets the page, and browsing gets
 * the room — the same trade the pack browser already made inside the panel.
 *
 * It is a real modal, unlike the sequence editor: there is nothing to do
 * underneath it while you pick a sound, so `EditorView` hands it the `dialog`
 * shortcut context and `Escape` closes it like any other dialog.
 */
export default function LibraryModal(props: LibraryModalProps): JSX.Element {
  let closeButton!: HTMLButtonElement;

  onSettled(() => {
    const opener = document.activeElement;
    closeButton.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  });

  return (
    <div class="library-modal-backdrop">
      <div class="library-modal" role="dialog" aria-modal="true" aria-label="Library">
        <div class="library-modal-body">
          <LibraryBrowser
            client={props.client}
            previewEngine={props.previewEngine}
            analytics={props.analytics}
            onInsert={(asset) => props.onInsert(asset)}
            addedPackIds={props.addedPackIds}
            onAddPack={(pack) => props.onAddPack(pack)}
            onPackBrowserOpenChange={(open) => props.onPackBrowserOpenChange(open)}
          />
        </div>
        <footer class="library-modal-footer">
          <button
            type="button"
            class="library-modal-close"
            ref={closeButton}
            onClick={() => props.onClose()}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
