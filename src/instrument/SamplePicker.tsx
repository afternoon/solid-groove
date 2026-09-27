import { For, type JSX, Show } from "@solidjs/web";
import { createEffect, createSignal } from "solid-js";
import type { Asset } from "../domain/entities";
import type { AssetId } from "../domain/ids";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import type { ShortcutHandlers } from "../shortcuts";
import { useShortcuts } from "../shortcuts";
import "./SamplePicker.css";

export interface SamplePickerProps {
  /** What the picker chooses for, e.g. "Sample for Kick". */
  readonly label: string;
  readonly current: AssetId | null;
  /** The project's sounds a slot can take. */
  readonly assets: readonly Asset[];
  onChoose(assetId: AssetId | null): void;
  /** Offer "None", for a slot that may be empty (a drum pad). */
  readonly allowNone?: boolean;
  /** Offer the library, for sounds the project does not carry yet. */
  readonly onBrowse?: () => void;
}

/**
 * The sample slot as a button that names what is loaded and opens a menu of
 * the project's sounds (#447). The menu closes on a choice, a click anywhere
 * else, or `view.close_surface` (Escape) from the shortcut registry — the
 * picker never reads a key itself.
 */
export default function SamplePicker(props: SamplePickerProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let root: HTMLDivElement | undefined;
  let button: HTMLButtonElement | undefined;

  const currentName = () =>
    props.assets.find((asset) => asset.id === props.current)?.name ?? "None";

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button?.focus();
  };
  const choose = (assetId: AssetId | null) => {
    close(true);
    if (assetId !== props.current) props.onChoose(assetId);
  };

  useShortcuts({
    handlers: (): ShortcutHandlers => ({
      "view.close_surface": { run: () => close(true), isEnabled: () => open() },
    }),
    contexts: () => [],
  });

  // While open, a press anywhere outside closes it, and the chosen sound (or
  // the first item) takes focus so the keyboard starts inside the menu.
  createEffect(
    () => open(),
    (isOpen) => {
      if (!isOpen) return;
      queueMicrotask(() =>
        (
          root?.querySelector<HTMLElement>('[aria-checked="true"]') ??
          root?.querySelector<HTMLElement>('[role^="menuitem"]')
        )?.focus(),
      );
      const outside = (event: PointerEvent) => {
        if (!root?.contains(event.target as Node)) close(false);
      };
      document.addEventListener("pointerdown", outside);
      return () => document.removeEventListener("pointerdown", outside);
    },
  );

  return (
    <div class="sample-picker" ref={root}>
      <button
        ref={button}
        type="button"
        class="sample-picker-button"
        aria-haspopup="menu"
        aria-expanded={open() ? "true" : "false"}
        aria-label={props.label}
        onClick={() => setOpen(!open())}
      >
        {/* A recorded sound's name is the user's; mask it (ADR 0002). */}
        <span class={`sample-picker-name ${MASK_CONTENT}`}>{currentName()}</span>
      </button>
      <Show when={open()}>
        <div class="sample-picker-menu" role="menu" aria-label={props.label}>
          <For each={props.assets}>
            {(asset) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={asset.id === props.current ? "true" : "false"}
                class={MASK_CONTENT}
                onClick={() => choose(asset.id)}
              >
                {asset.name}
              </button>
            )}
          </For>
          <Show when={props.allowNone}>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={props.current === null ? "true" : "false"}
              onClick={() => choose(null)}
            >
              None
            </button>
          </Show>
          <Show when={props.onBrowse}>
            {(browse) => (
              <>
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close(false);
                    browse()();
                  }}
                >
                  Browse the library…
                </button>
              </>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
