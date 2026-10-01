import { type JSX, Show } from "@solidjs/web";
import { HiSolidXMark } from "solid-icons/hi";
import { createMemo, createSignal, onSettled } from "solid-js";
import type { LibraryClient } from "./libraryClient";
import PackCover from "./PackCover";
import { type PackCatalogEntry, packCategories, watchPackCatalog } from "./packCatalog";
import "./PackBanner.css";

/**
 * The banner above an opened pack's sounds (LIB-010): name, publisher, version,
 * counts, description, and whether the pack is already in the project or joins
 * it when a sound is inserted. Renders nothing for a slug the index lacks.
 * With `onClose`, a close button leaves the pack for all sounds.
 */
export default function PackBanner(props: {
  readonly client: LibraryClient;
  readonly slug: string;
  readonly projectPackIds: readonly string[];
  onClose?(): void;
}): JSX.Element {
  const [entries, setEntries] = createSignal<readonly PackCatalogEntry[]>([]);
  onSettled(() => watchPackCatalog(props.client, setEntries));
  const entry = createMemo(() => entries().find((e) => e.pack.slug === props.slug));
  const inProject = () => {
    const found = entry();
    return found !== undefined && props.projectPackIds.includes(found.pack.id);
  };

  return (
    <Show when={entry()}>
      {(found) => (
        <section class="pack-banner" aria-label={`About ${found().pack.name}`}>
          <PackCover small name={found().pack.name} assets={found().assets} />
          <div class="pack-banner-text">
            <h3 class="pack-banner-name">{found().pack.name}</h3>
            <p>
              {found().pack.publisher} · v{found().pack.version} ·{" "}
              {found().pack.assetCount} sounds
              <Show when={found().assets}>
                {(assets) => <> in {packCategories(assets()).length} categories</>}
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
