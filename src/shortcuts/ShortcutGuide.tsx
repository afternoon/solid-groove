import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics";
import { detectPlatform, type ShortcutPlatform } from "./keys";
import {
  isInContext,
  resolveContexts,
  type ShortcutActionId,
  type ShortcutDefinition,
  shortcutLabels,
  shortcutSections,
} from "./registry";
import type { ShortcutContext } from "./types";
import { SHORTCUT_GROUP_LABELS } from "./types";
import "./ShortcutGuide.css";

export interface ShortcutGuideProps {
  /** Contexts active behind the guide, so it can filter to what applies now. */
  readonly contexts: readonly ShortcutContext[];
  /** Whether an action has an enabled handler right now. Defaults to unknown-as-enabled. */
  readonly isEnabled?: (id: ShortcutActionId) => boolean;
  readonly platform?: ShortcutPlatform;
  /** Defaults to the application's singleton; injectable for tests. */
  readonly analytics?: Analytics;
  onClose(): void;
}

/** Whether a query matches an action name or one of its key combinations. */
function matchesQuery(
  shortcut: ShortcutDefinition,
  labels: readonly string[],
  query: string,
): boolean {
  if (query === "") return true;
  const needle = query.toLowerCase();
  if (shortcut.label.toLowerCase().includes(needle)) return true;
  if (shortcut.description.toLowerCase().includes(needle)) return true;
  return labels.some((label) => label.toLowerCase().includes(needle));
}

/** The one-line Ableton note `KEY-02` requires for every mapping. */
function abletonNote(shortcut: ShortcutDefinition): string {
  const parity = shortcut.ableton;
  if (parity.kind === "follows") {
    return `Same as Ableton Live (${parity.abletonKeys}).`;
  }
  if (parity.kind === "differs") {
    return `Live uses ${parity.abletonKeys}. ${parity.reason}`;
  }
  return `Solid Groove addition. ${parity.reason}`;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The PRD `KEY-02` keyboard mapping guide.
 *
 * Every row is generated from the `KEY-01` registry — nothing here restates a
 * key combination — so the guide reflects the current platform's labels, the
 * contexts active behind it, and which actions actually have a handler.
 *
 * `Escape` is *not* handled here: it is `view.close_surface` in the registry,
 * dispatched by the same controller as every other shortcut, which is what
 * keeps "closes it from anywhere" a single rule rather than a per-modal
 * listener. Focus is captured on open and restored on close.
 */
export default function ShortcutGuide(props: ShortcutGuideProps): JSX.Element {
  const titleId = createUniqueId();
  const instructionsId = createUniqueId();
  const [query, setQuery] = createSignal("");
  const [contextOnly, setContextOnly] = createSignal(false);
  let dialog: HTMLDivElement | undefined;
  let search: HTMLInputElement | undefined;

  const platform = createMemo(() => props.platform ?? detectPlatform());
  const resolved = createMemo(() => resolveContexts(props.contexts));

  const available = (shortcut: ShortcutDefinition): boolean =>
    isInContext(shortcut, resolved()) && (props.isEnabled?.(shortcut.id) ?? true);

  const sections = createMemo(() => {
    const currentQuery = query().trim();
    return shortcutSections().flatMap((section) => {
      const rows = section.shortcuts
        .map((shortcut) => ({
          shortcut,
          labels: shortcutLabels(shortcut, platform()),
          available: available(shortcut),
        }))
        .filter(
          (row) =>
            matchesQuery(row.shortcut, row.labels, currentQuery) &&
            (!contextOnly() || row.available),
        );
      return rows.length > 0 ? [{ group: section.group, rows }] : [];
    });
  });

  onMount(() => {
    const previous = document.activeElement;
    search?.focus();
    (props.analytics ?? defaultAnalytics).logFeatureFirstUse("shortcut_guide");
    onCleanup(() => {
      // `KEY-02`: closing "restores focus to the prior editor element".
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    });
  });

  /** Keeps Tab inside the modal (`KEY-02`: "traps focus while modal"). */
  function trapFocus(event: KeyboardEvent): void {
    if (event.key !== "Tab" || !dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div class="shortcut-guide-backdrop">
      <div
        class="shortcut-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={instructionsId}
        ref={dialog}
        onKeyDown={trapFocus}
      >
        <header class="shortcut-guide-header">
          <h2 class="shortcut-guide-title" id={titleId}>
            Keyboard shortcuts
          </h2>
          <p class="shortcut-guide-instructions" id={instructionsId}>
            Search by action or key combination. Press Escape to close and return to the
            editor.
          </p>
          <div class="shortcut-guide-filters">
            <input
              class="shortcut-guide-search"
              type="search"
              aria-label="Search shortcuts"
              placeholder="Search shortcuts"
              value={query()}
              ref={search}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <label class="shortcut-guide-context-filter">
              <input
                type="checkbox"
                checked={contextOnly()}
                onChange={(event) => setContextOnly(event.currentTarget.checked)}
              />
              Only shortcuts available here
            </label>
          </div>
        </header>
        <div class="shortcut-guide-sections">
          <For each={sections()}>
            {(section) => (
              <section class="shortcut-guide-section">
                <h3 class="shortcut-guide-section-title">
                  {SHORTCUT_GROUP_LABELS[section.group]}
                </h3>
                <ul class="shortcut-guide-list">
                  <For each={section.rows}>
                    {(row) => (
                      <li
                        class="shortcut-guide-row"
                        data-action={row.shortcut.id}
                        data-available={String(row.available)}
                      >
                        <div class="shortcut-guide-action">
                          <span class="shortcut-guide-action-label">
                            {row.shortcut.label}
                          </span>
                          <span class="shortcut-guide-action-description">
                            {row.shortcut.description}
                          </span>
                          <span class="shortcut-guide-ableton">
                            {abletonNote(row.shortcut)}
                          </span>
                          <Show when={row.shortcut.browserConflict}>
                            {(conflict) => (
                              <span class="shortcut-guide-browser-note">
                                Browser conflict: {conflict().note}
                              </span>
                            )}
                          </Show>
                        </div>
                        <div class="shortcut-guide-keys">
                          <For each={row.labels}>{(label) => <kbd>{label}</kbd>}</For>
                          <Show when={!row.available}>
                            <span class="shortcut-guide-unavailable">
                              Not available here
                            </span>
                          </Show>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
          <Show when={sections().length === 0}>
            <p class="shortcut-guide-empty">No shortcuts match your search.</p>
          </Show>
        </div>
        <footer class="shortcut-guide-footer">
          <button
            type="button"
            class="shortcut-guide-close"
            onClick={() => props.onClose()}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
