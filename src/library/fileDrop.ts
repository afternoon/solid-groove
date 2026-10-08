import { createSignal, onCleanup } from "solid-js";
import { importContentType } from "../userData/userData";

/**
 * Dropping audio files from the desktop into a personal pack (#282): the drop
 * targets the rail's packs and an opened pack's sounds share (GRV-52).
 */

/** What a drop target shows: nothing, "drop here", or "not audio". */
export type DropState = "none" | "accepted" | "refused";

/** Whether a drag carries files, and whether any of them is audio we take. */
function dragVerdict(event: DragEvent): DropState {
  const transfer = event.dataTransfer;
  if (!transfer || !Array.from(transfer.types ?? []).includes("Files")) return "none";
  const items = Array.from(transfer.items ?? []).filter((item) => item.kind === "file");
  // Some browsers hide the types until the drop; give those the benefit of the doubt.
  if (items.length === 0 || items.every((item) => item.type === "")) return "accepted";
  return items.some((item) => importContentType({ name: "", type: item.type }) !== null)
    ? "accepted"
    : "refused";
}

/** How long a refused drop's "not audio" stays up after the files are let go. */
const REFUSED_DROP_MS = 2500;

/**
 * Handlers that make an element a drop target for audio files. `state` is
 * what the affordance shows. A drop with no audio in it at all is refused
 * outright and imports nothing; one with some audio imports every file, and
 * each one we cannot take says why.
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [state, setState] = createSignal<DropState>("none");
  let depth = 0;
  let refusedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(refusedTimer));
  const handlers = {
    onDragEnter(event: DragEvent) {
      const verdict = dragVerdict(event);
      if (verdict === "none") return;
      clearTimeout(refusedTimer);
      event.preventDefault();
      event.stopPropagation();
      depth += 1;
      setState(verdict);
    },
    onDragOver(event: DragEvent) {
      const verdict = dragVerdict(event);
      if (verdict === "none") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = verdict === "accepted" ? "copy" : "none";
      }
      setState(verdict);
    },
    onDragLeave(event: DragEvent) {
      if (dragVerdict(event) === "none") return;
      event.stopPropagation();
      depth = Math.max(0, depth - 1);
      if (depth === 0) setState("none");
    },
    onDrop(event: DragEvent) {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      depth = 0;
      if (!files.some((file) => importContentType(file) !== null)) {
        setState("refused");
        clearTimeout(refusedTimer);
        refusedTimer = setTimeout(() => setState("none"), REFUSED_DROP_MS);
        return;
      }
      setState("none");
      onFiles(files);
    },
  };
  return { state, handlers };
}
