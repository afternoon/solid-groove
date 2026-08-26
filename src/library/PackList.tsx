import { For, type JSX, Show } from "@solidjs/web";
import { HiSolidCheckCircle } from "solid-icons/hi";
import { createMemo, createSignal } from "solid-js";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { KIND_LABELS } from "./LibraryFacets";
import type { LibraryPackSummary } from "./manifest";
import { EMPTY_PACK_FILTER, filterPacks, type PackKind } from "./search";
import type { useLibraryBrowser } from "./useLibraryBrowser";
import "./PackBrowser.css";

/**
 * The pack browser's left rail: every pack, narrowed by name and by kind, plus
 * the cross-pack "All sounds" way in.
 *
 * Its filter is deliberately local. Narrowing *this list* is navigation — it
 * decides which packs are offered, never which sounds a chosen pack shows — so
 * it is separate from the asset filter `useLibraryBrowser` owns, and it reads
 * the index alone: filtering by name or kind fetches no manifest
 * (sample-library section 12).
 */
export default function PackList(props: {
  browser: ReturnType<typeof useLibraryBrowser>;
  /** Whether the project already has a pack, so an added pack says so. */
  isAdded: (pack: LibraryPackSummary) => boolean;
}): JSX.Element {
  const { browser } = props;
  const [packFilter, setPackFilter] = createSignal(EMPTY_PACK_FILTER);

  const visiblePacks = createMemo(() => filterPacks(browser.packs(), packFilter()));

  function toggleKind(kind: PackKind): void {
    setPackFilter((prev) => ({
      ...prev,
      kinds: prev.kinds.includes(kind)
        ? prev.kinds.filter((existing) => existing !== kind)
        : [...prev.kinds, kind],
    }));
  }

  const kinds = createMemo<PackKind[]>(() => {
    const present = new Set(browser.packs().map((pack) => pack.kind));
    return (["factory", "third-party", "user"] as const).filter((kind) =>
      present.has(kind),
    );
  });

  return (
    <nav class="pack-browser-list" aria-label="Packs">
      {/* What the user typed (ADR 0002 decision 2). */}
      <input
        type="search"
        class={`pack-browser-search ${MASK_CONTENT}`}
        placeholder="Search packs"
        aria-label="Search packs"
        value={packFilter().query}
        onInput={(event) =>
          setPackFilter((prev) => ({
            ...prev,
            query: event.currentTarget.value,
          }))
        }
      />
      <div class="pack-browser-kinds">
        <For each={kinds()}>
          {(kind) => {
            const active = createMemo(() => packFilter().kinds.includes(kind));
            return (
              <button
                type="button"
                class={["library-chip", { "library-chip-active": active() }]}
                aria-pressed={active() ? "true" : "false"}
                onClick={() => toggleKind(kind)}
              >
                {KIND_LABELS[kind]}
              </button>
            );
          }}
        </For>
      </div>
      <ul class="pack-browser-packs">
        <li>
          <button
            type="button"
            class={[
              "pack-browser-pack",
              {
                "pack-browser-pack-active": browser.selectedPackSlug() === null,
              },
            ]}
            aria-pressed={browser.selectedPackSlug() === null ? "true" : "false"}
            onClick={() => void browser.selectPack(null)}
          >
            <span class="pack-browser-pack-name">All sounds</span>
            <span class="pack-browser-pack-meta">Every pack</span>
          </button>
        </li>
        <For each={visiblePacks()}>
          {(pack) => {
            const failed = createMemo(() =>
              browser.packErrors().some((error) => error.packSlug === pack.slug),
            );
            return (
              <li>
                <button
                  type="button"
                  class={[
                    "pack-browser-pack",
                    {
                      "pack-browser-pack-active":
                        browser.selectedPackSlug() === pack.slug,
                      "pack-browser-pack-failed": failed(),
                    },
                  ]}
                  aria-pressed={
                    browser.selectedPackSlug() === pack.slug ? "true" : "false"
                  }
                  onClick={() => void browser.selectPack(pack.slug)}
                >
                  <span class="pack-browser-pack-name">{pack.name}</span>
                  <span class="pack-browser-pack-meta">
                    {pack.publisher} ·{" "}
                    {failed() ? "unavailable" : `${pack.assetCount} sounds`}
                  </span>
                  <Show when={props.isAdded(pack)}>
                    <span class="pack-browser-pack-added">
                      <HiSolidCheckCircle size={14} />
                      <span class="visually-hidden">Added</span>
                    </span>
                  </Show>
                </button>
              </li>
            );
          }}
        </For>
        <Show when={visiblePacks().length === 0}>
          <li class="pack-browser-no-packs">
            No packs match. Clear the search to see them all.
          </li>
        </Show>
      </ul>
    </nav>
  );
}
