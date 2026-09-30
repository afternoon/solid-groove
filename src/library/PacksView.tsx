import { For, type JSX, Show } from "@solidjs/web";
import { createMemo, createSignal, onSettled } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import { ariaBool } from "../shared/aria";
import type { ShortcutActionId } from "../shortcuts";
import type { LibraryClient } from "./libraryClient";
import PackCover from "./PackCover";
import {
  coverCategoryLine,
  familyChoices,
  type PackCatalogEntry,
  packCategories,
  packHasFamily,
  watchPackCatalog,
} from "./packCatalog";
import type { ShelfFamily } from "./shelf";
import "./PacksView.css";

export interface PacksViewProps {
  readonly client: LibraryClient;
  readonly analytics?: Analytics;
  /** Pack IDs the project holds, for the "In project" tag. */
  readonly projectPackIds: readonly string[];
  /** Key badge text for a registry action, from the registry. */
  keyLabel?(action: ShortcutActionId): string | undefined;
  onOpenPack(slug: string): void;
  /** Hands the host a way to open the nth visible pack, for the digit keys. */
  onRegisterOpenNth?(openNth: ((n: number) => void) | null): void;
}

/**
 * Browse packs (LIB-010): a grid of typographic pack covers, a "Packs with"
 * family filter, and per pack its biggest categories.
 * Opening a pack is the host's business (`onOpenPack`); this only chooses.
 */
export default function PacksView(props: PacksViewProps): JSX.Element {
  const analytics = props.analytics ?? defaultAnalytics;
  const [entries, setEntries] = createSignal<readonly PackCatalogEntry[]>([]);
  const [family, setFamily] = createSignal<ShelfFamily | null>(null);
  const isProject = (id: string) => props.projectPackIds.includes(id);
  const visible = createMemo(() =>
    entries().filter((entry) => packHasFamily(entry, family())),
  );

  onSettled(() => {
    analytics.logFeatureFirstUse("pack_browser");
    props.onRegisterOpenNth?.((n) => {
      const entry = visible()[n - 1];
      if (entry) props.onOpenPack(entry.pack.slug);
    });
    const cancel = watchPackCatalog(props.client, setEntries);
    return () => {
      cancel();
      props.onRegisterOpenNth?.(null);
    };
  });

  /** The badge for the nth cover: only the first nine have a key. */
  const pickKey = (index: number) =>
    index < 9
      ? props.keyLabel?.(`library.pick_${index + 1}` as ShortcutActionId)
      : undefined;

  return (
    <section class="packs-view" aria-label="Packs">
      <fieldset class="packs-filter">
        <legend class="packs-filter-label">Packs with</legend>
        <button
          type="button"
          class="packs-chip"
          aria-pressed={ariaBool(family() === null)}
          onClick={() => setFamily(null)}
        >
          Anything
        </button>
        <For each={familyChoices(entries())}>
          {(choice) => (
            <button
              type="button"
              class="packs-chip"
              aria-pressed={ariaBool(family() === choice.key)}
              onClick={() => setFamily(choice.key)}
            >
              {choice.label}
            </button>
          )}
        </For>
        <span class="packs-count">
          {visible().length} of {entries().length} packs
        </span>
      </fieldset>
      <Show
        when={visible().length > 0}
        fallback={
          <p class="packs-empty">
            No packs match.
            <button type="button" onClick={() => setFamily(null)}>
              Show every pack
            </button>
          </p>
        }
      >
        <ul class="packs-grid">
          <For each={visible()}>
            {(entry, index) => (
              <li class="pack-card">
                <button
                  type="button"
                  class="pack-open"
                  aria-label={`Open ${entry.pack.name}`}
                  onClick={() => props.onOpenPack(entry.pack.slug)}
                >
                  <PackCover name={entry.pack.name} assets={entry.assets}>
                    <Show when={isProject(entry.pack.id)}>
                      <span class="pack-tag">In project</span>
                    </Show>
                    <Show when={pickKey(index())}>
                      {(label) => <kbd class="pack-key">{label()}</kbd>}
                    </Show>
                  </PackCover>
                  <b class="pack-name">{entry.pack.name}</b>
                  <span class="pack-meta">
                    {entry.pack.publisher} · {entry.pack.assetCount} sounds
                    <Show when={entry.assets}>
                      {(assets) => <> · {packCategories(assets()).length} categories</>}
                    </Show>
                  </span>
                  <span class="pack-mix">{coverCategoryLine(entry.assets ?? [])}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
