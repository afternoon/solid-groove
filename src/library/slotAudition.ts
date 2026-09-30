import type { PreviewEngine, PreviewVoice } from "./audition";
import type { LibraryAsset } from "./manifest";

/**
 * The slot the library was opened for, as the audio layer's hot-swap sees it
 * (LIB-010). `preview` swaps a sound into the slot's instrument, audio only,
 * and answers whether the slot can play it (a loop it cannot, and clears).
 * `clear` puts the slot's own sound back. Neither touches the project: no
 * command, no history entry, no save and no revision.
 */
export interface SlotAudition {
  preview(asset: LibraryAsset): boolean;
  clear(): void;
  isPlaying(): boolean;
}

/**
 * A {@link PreviewEngine} that auditions through the target slot, so a sound is
 * heard in the beat (LIB-010 hot-swap). Every view's audition controller keeps
 * its policy; only where the sound plays changes:
 *
 * - a one-shot is swapped into the slot. While the transport runs, that is the
 *   whole audition. While it is stopped the slot is silent, so the sound also
 *   plays standalone, as it did before hot-swap;
 * - a sound the slot cannot hold (a loop) plays standalone, where the base
 *   engine time-stretches it to the song and drops it in on the next bar;
 * - stopping a voice puts the slot back on the **selected** sound, or on its
 *   own when nothing is selected, so a pack's Hear it run or the similar view's
 *   reference card never leaves a sound in the slot that Insert would not put
 *   there;
 * - disposing (the library closing) clears the override: Escape, close and
 *   Insert all end there.
 */
export function slotPreviewEngine(
  base: PreviewEngine,
  slot: SlotAudition,
  selected: () => LibraryAsset | null,
): PreviewEngine {
  let disposed = false;

  function restore(): void {
    if (disposed) return;
    const sound = selected();
    if (sound) slot.preview(sound);
    else slot.clear();
  }

  function voiceOf(inner: PreviewVoice | null): PreviewVoice {
    let stopped = false;
    return {
      stop() {
        if (stopped) return;
        stopped = true;
        inner?.stop();
        restore();
      },
    };
  }

  return {
    async start(asset, options) {
      const inSlot = !disposed && slot.preview(asset);
      if (inSlot && slot.isPlaying()) return voiceOf(null);
      try {
        return voiceOf(await base.start(asset, options));
      } catch (error) {
        // A sound that cannot load must not stay in the slot.
        restore();
        throw error;
      }
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        slot.clear();
      }
      return base.dispose();
    },
  };
}
