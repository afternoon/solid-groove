import { type LibrarySample, librarySampleSchema, toLibrarySample } from "./insertion";
import type { LibraryAsset } from "./manifest";

/**
 * Carrying a library sound on a drag (#225, PRD LIB-01).
 *
 * Dragging is how a producer expects to put a sound on a track, and the web's
 * drag surface is a `DataTransfer`: a string keyed by MIME type, shared with
 * every other page and application the user might drag between. Two rules follow
 * from that, and this module is where both live so no component repeats them:
 *
 * - **The payload is described, not referenced.** A module-level "currently
 *   dragging" variable would be simpler and wrong: it survives a cancelled
 *   drag, and it cannot cross a window. The sound travels as its own JSON, under
 *   a type of ours.
 * - **What comes back is input.** Any page can write this MIME type, so a drop
 *   parses the payload through `librarySampleSchema` and ignores anything that
 *   does not fit, rather than casting whatever the transfer held.
 *
 * A `dragover` may not read the transfer's *data* at all — browsers expose only
 * the type list until the drop — which is why {@link hasLibrarySampleDrag} asks
 * about types and {@link readLibrarySampleDrag} is used only from `drop`.
 */

/** The drag type a library sound travels under. */
export const LIBRARY_SAMPLE_MIME = "application/x-solid-groove-library-sample";

/**
 * The slice of `DataTransfer` these use. Structural rather than the DOM type so
 * a test can hand in a plain object — jsdom implements no `DataTransfer` at all.
 */
export interface LibraryDragTransfer {
  readonly types: readonly string[];
  getData(format: string): string;
  setData(format: string, data: string): void;
  effectAllowed?: string;
  dropEffect?: string;
}

/**
 * Puts a browsed sound on the drag, and reports whether it could. An asset with
 * no master audio (a preset) carries nothing a track can load, so its row starts
 * no drag rather than starting one that must be refused on drop.
 */
export function writeLibrarySampleDrag(
  transfer: LibraryDragTransfer | null | undefined,
  asset: LibraryAsset,
): boolean {
  const sample = toLibrarySample(asset);
  if (!transfer || !sample) return false;
  transfer.setData(LIBRARY_SAMPLE_MIME, JSON.stringify(sample));
  transfer.effectAllowed = "copy";
  return true;
}

/** Whether this drag is carrying a library sound, from the type list alone. */
export function hasLibrarySampleDrag(
  transfer: LibraryDragTransfer | null | undefined,
): boolean {
  return [...(transfer?.types ?? [])].includes(LIBRARY_SAMPLE_MIME);
}

/** The sound a drop is carrying, or `null` when it is carrying something else. */
export function readLibrarySampleDrag(
  transfer: LibraryDragTransfer | null | undefined,
): LibrarySample | null {
  if (!hasLibrarySampleDrag(transfer)) return null;
  const raw = transfer?.getData(LIBRARY_SAMPLE_MIME);
  if (!raw) return null;
  try {
    const parsed = librarySampleSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Not JSON at all: a page outside this app wrote our type.
    return null;
  }
}

export type { LibrarySample };
