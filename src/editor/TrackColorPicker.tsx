import { For, type JSX, Portal, Show } from "@solidjs/web";
import { createEffect, createSignal } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { RawCommandInput, TransactionResult } from "../commands";
import { updateTrack } from "../commands";
import type { Track } from "../domain/entities";
import { TRACK_COLORS } from "../domain/factories";
import { ariaBool } from "../shared/aria";
import { type ShortcutHandlers, useShortcuts } from "../shortcuts";
import "./TrackColorPicker.css";

export interface TrackColorPickerProps {
  readonly track: Track;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  /** Defaults to the application singleton; injectable for tests. */
  readonly analytics?: Analytics;
}

/**
 * A track's colour swatch, which is also where the colour is chosen (#447).
 * It opens the track palette; a choice is one `track.update`, undoable like
 * any edit. The menu closes on a choice, a press anywhere else, or
 * `view.close_surface` (Escape) — it never reads a key itself.
 *
 * The menu is portalled to the body: the arrangement's header column clips
 * and translates its rows, which would cut a menu off inside the row.
 */
export default function TrackColorPicker(props: TrackColorPickerProps): JSX.Element {
  const analytics = () => props.analytics ?? defaultAnalytics;
  const [at, setAt] = createSignal<{ left: number; top: number } | null>(null);
  let button: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;

  const open = () => at() !== null;
  const close = (refocus: boolean) => {
    setAt(null);
    if (refocus) button?.focus();
  };
  const toggle = () => {
    if (open() || !button) return close(false);
    const rect = button.getBoundingClientRect();
    setAt({ left: rect.left, top: rect.bottom + 4 });
  };
  const choose = (color: string) => {
    close(true);
    if (color === props.track.color) return;
    const result = props.dispatch(updateTrack(props.track.id, { color }));
    if (result?.ok) analytics().logFeatureFirstUse("track_color");
  };

  useShortcuts({
    handlers: (): ShortcutHandlers => ({
      "view.close_surface": { run: () => close(true), isEnabled: open },
    }),
    contexts: () => [],
  });

  // While open, a press outside closes it, and the current colour (or the
  // first) takes focus so the keyboard starts inside the menu.
  createEffect(open, (isOpen) => {
    if (!isOpen) return;
    queueMicrotask(() =>
      (
        menu?.querySelector<HTMLElement>('[aria-checked="true"]') ??
        menu?.querySelector<HTMLElement>("button")
      )?.focus(),
    );
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu?.contains(target) && !button?.contains(target)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  });

  return (
    <>
      <button
        ref={button}
        type="button"
        class="track-header-swatch"
        style={{ background: props.track.color }}
        aria-haspopup="menu"
        aria-expanded={ariaBool(open())}
        aria-label={`Colour for ${props.track.name}`}
        onClick={toggle}
      />
      <Show when={at()}>
        {(position) => (
          <Portal>
            <div
              ref={menu}
              class="track-color-menu"
              role="menu"
              aria-label={`Colour for ${props.track.name}`}
              style={{ left: `${position().left}px`, top: `${position().top}px` }}
            >
              <For each={TRACK_COLORS}>
                {(color, index) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={ariaBool(color === props.track.color)}
                    aria-label={`Colour ${index() + 1}`}
                    style={{ background: color }}
                    onClick={() => choose(color)}
                  />
                )}
              </For>
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
}
