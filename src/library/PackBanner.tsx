import { type JSX, Show } from "@solidjs/web";
import { HiSolidXMark } from "solid-icons/hi";
import { createMemo, createSignal, onSettled } from "solid-js";
import type { LibraryClient } from "./libraryClient";
import type { LibraryAssetType } from "./manifest";
import PackCover from "./PackCover";
import {
  categoriesLabel,
  type PackCatalogEntry,
  packCounts,
  scopeEntry,
  watchPackCatalog,
} from "./packCatalog";
import "./PackBanner.css";

/**
 * The banner above an opened pack's sounds (LIB-010): name, publisher, version,
 * counts, description, and whether the pack is already in the project or joins
 * it when a sound is inserted. Renders nothing for a slug the index lacks.
 * With `onClose`, a close button leaves the pack for all sounds. The banner
 * takes focus (`onBanner`), so a pack opened from a control that goes away is where
 * the keyboard lands (#1011).
 */
export default function PackBanner(props: {
  readonly client: LibraryClient;
  readonly slug: string;
  readonly projectPackIds: readonly string[];
  /** The asset types the library was opened for: the counts are of these alone (GRV-48). */
  readonly assetTypes?: readonly LibraryAssetType[];
  onClose?(): void;
  /** Handed the banner once it renders: it is focusable but not a tab stop. */
  onBanner?(banner: HTMLElement): void;
}): JSX.Element {
  const [entries, setEntries] = createSignal<readonly PackCatalogEntry[]>([]);
  onSettled(() => watchPackCatalog(props.client, setEntries));
  // Only what the pack's shelf shows in this scope, so the counts match it.
  const entry = createMemo(() => {
    const found = entries().find((e) => e.pack.slug === props.slug);
    return found && scopeEntry(found, props.assetTypes);
  });
  const inProject = () => {
    const found = entry();
    return found !== undefined && props.projectPackIds.includes(found.pack.id);
  };

  return (
    <Show when={entry()}>
      {(found) => (
        <section
          ref={(banner) => props.onBanner?.(banner)}
          class="pack-banner"
          aria-label={`About ${found().pack.name}`}
          tabindex="-1"
        >
          <PackCover small name={found().pack.name} assets={found().assets} />
          <div class="pack-banner-text">
            <h3 class="pack-banner-name">{found().pack.name}</h3>
            <p>
              {found().pack.publisher} · v{found().pack.version} ·{" "}
              {packCounts(found()).sounds} sounds
              <Show when={packCounts(found()).categories}>
                {(categories) => <> in {categoriesLabel(categories())}</>}
              </Show>
              . {found().pack.description}
            </p>
          </div>
          <span class={inProject() ? "pack-banner-status in" : "pack-banner-status"}>
            {inProject()
              ? "In this project"
              : "Joins the project when you insert a sound"}
          </span>
          <Show when={props.onClose}>
            <button
              type="button"
              class="pack-banner-close"
              aria-label="Back to all sounds"
              onClick={() => props.onClose?.()}
            >
              <HiSolidXMark size={15} />
            </button>
          </Show>
        </section>
      )}
    </Show>
  );
}
