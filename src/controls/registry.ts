import { type Accessor, createSignal } from "solid-js";
import { type ControlAddress, controlKey } from "../commands/controlAddress";

/**
 * How a control is marked (`UI-004`, #850): not at all, `previewed` while a
 * proposed change to it is shown (a dashed outline), or `changed` once a
 * change to it has landed (a solid one).
 */
export type ControlMark = "none" | "previewed" | "changed";
export const CONTROL_MARKS: readonly ControlMark[] = ["none", "previewed", "changed"];

/**
 * The editor's controls by address, and the mark on each (`UI-004`, #850).
 *
 * A control registers its element when it mounts (`control()` in
 * `./control.ts`) and leaves when it unmounts, so the registry only ever holds
 * what is on screen. Several elements may share one address — a track's volume
 * is a fader in its mixer strip and in its header — and every one of them
 * wears the address's mark.
 *
 * Marks are set per address, whether or not anything showing it is mounted:
 * a control that mounts later (switching to the mixer) picks its mark up.
 * Like selection, marks are UI-only: nothing here reads or writes a project,
 * a history or a save.
 */
export interface ControlRegistry {
  /** Adds an element for `address`. Returns the call that removes it again. */
  register(address: ControlAddress, element: HTMLElement): () => void;
  /** The mounted elements for `address`, oldest first. */
  elementsFor(address: ControlAddress): readonly HTMLElement[];
  /** The mark on `address`. Reactive. */
  markOf(address: ControlAddress): ControlMark;
  /** Every address with a mark other than `none`, by `controlKey`. Reactive. */
  marks: Accessor<ReadonlyMap<string, Exclude<ControlMark, "none">>>;
  /** Marks each of `addresses`; `none` clears them. */
  setMark(addresses: ControlAddress | readonly ControlAddress[], mark: ControlMark): void;
  /** Clears every mark. */
  clearMarks(): void;
}

export function createControlRegistry(): ControlRegistry {
  const elements = new Map<string, HTMLElement[]>();
  const [marks, setMarks] = createSignal<
    ReadonlyMap<string, Exclude<ControlMark, "none">>
  >(new Map());

  return {
    register(address, element) {
      const key = controlKey(address);
      const list = elements.get(key) ?? [];
      list.push(element);
      elements.set(key, list);
      return () => {
        const current = elements.get(key);
        if (!current) return;
        const remaining = current.filter((candidate) => candidate !== element);
        if (remaining.length === 0) elements.delete(key);
        else elements.set(key, remaining);
      };
    },
    elementsFor(address) {
      return elements.get(controlKey(address)) ?? [];
    },
    markOf(address) {
      return marks().get(controlKey(address)) ?? "none";
    },
    marks,
    setMark(addresses, mark) {
      const list = Array.isArray(addresses)
        ? (addresses as readonly ControlAddress[])
        : [addresses as ControlAddress];
      setMarks((current) => {
        const next = new Map(current);
        for (const address of list) {
          const key = controlKey(address);
          if (mark === "none") next.delete(key);
          else next.set(key, mark);
        }
        return next;
      });
    },
    clearMarks() {
      setMarks(new Map());
    },
  };
}
