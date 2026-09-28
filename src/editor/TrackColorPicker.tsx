import { For, type JSX, Portal, Show } from "@solidjs/web";
import { createEffect, createSignal } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { RawCommandInput, TransactionResult } from "../commands";
import { updateTrack } from "../commands";
import type { Track } from "../domain/entities";
import { TRACK_PALETTE } from "../domain/trackPalette";
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
  /**
   * "swatch" (default) is the small colour square of a track header; "bar" is
   * a transparent hit area laid over the colour border along a mixer strip's
   * top edge, which is what shows the colour there.
   */
  readonly variant?: "swatch" | "bar";
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
  let menu: HTMLFieldSetElement | undefined;

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

  // While open, a press outside closes it, and the current colour (or the
  // first) takes focus so the keyboard starts inside the palette.
  createEffect(open, (isOpen) => {
    if (!isOpen) return;
    queueMicrotask(() =>
      (
        menu?.querySelector<HTMLElement>('[aria-pressed="true"]') ??
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
        class={props.variant === "bar" ? "mixer-strip-color" : "track-header-swatch"}
        style={props.variant === "bar" ? undefined : { background: props.track.color }}
        aria-expanded={ariaBool(open())}
        aria-label={`Colour for ${props.track.name}`}
        onClick={toggle}
      />
      <Show when={at()}>
        {(position) => (
          <Portal>
            <CloseOnEscape onClose={() => close(true)} />
            <fieldset
              ref={menu}
              class="track-color-menu"
              aria-label={`Colour for ${props.track.name}`}
              style={{ left: `${position().left}px`, top: `${position().top}px` }}
            >
              <For each={TRACK_PALETTE}>
                {(color, index) => (
                  <button
                    type="button"
                    aria-pressed={ariaBool(color === props.track.color)}
                    aria-label={`Colour ${index() + 1} of ${TRACK_PALETTE.length}`}
                    style={{ background: color }}
                    onClick={() => choose(color)}
                  />
                )}
              </For>
            </fieldset>
          </Portal>
        )}
      </Show>
    </>
  );
}

/**
 * `view.close_surface` (Escape) for the open palette, mounted only while it
 * is open: a closed picker, one per track header, installs no shortcut
 * controller at all.
 */
function CloseOnEscape(props: { onClose(): void }): JSX.Element {
  useShortcuts({
    handlers: (): ShortcutHandlers => ({
      "view.close_surface": { run: () => props.onClose() },
    }),
    contexts: () => [],
  });
  return null;
}
