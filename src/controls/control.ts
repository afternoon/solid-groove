import { type Accessor, createContext, createEffect, useContext } from "solid-js";
import { type ControlAddress, controlKey } from "../commands/controlAddress";
import type { ControlMark, ControlRegistry } from "./registry";
import "./controlMarks.css";

/**
 * The registry the editor's controls join. It has a `null` default rather
 * than none, so a control rendered outside an editor — a component test, a
 * dialog — simply registers nowhere instead of throwing.
 */
export const ControlRegistryContext = createContext<ControlRegistry | null>(null);

export function useControlRegistry(): ControlRegistry | null {
  return useContext(ControlRegistryContext);
}

/** An address, an accessor for one, or nothing to register. */
export type ControlAddressInput =
  | ControlAddress
  | Accessor<ControlAddress | undefined>
  | undefined;

/**
 * Registers the element it is put on as the control for an address
 * (`UI-004`, #850), and draws the address's mark on it:
 *
 * ```tsx
 * <div class="fill-slider" ref={control(() => props.control)}>
 * ```
 *
 * This is the Solid 2 form of the `use:control={address}` directive the issue
 * describes: Solid 2 has no `use:` namespace, and a ref callback built by a
 * factory is its replacement. It goes on the control's existing element, so no
 * wrapper changes a layout.
 *
 * The element carries `data-control` (the address's key) while registered and
 * `data-control-mark` while marked; `controlMarks.css` draws the outline from
 * that attribute, so every part that registers is outlined the same way.
 *
 * Call it in a component body or JSX — it reads the registry from context and
 * owns two effects. An accessor is re-read, so a control that moves to another
 * entity (a panel following the selected track) re-registers under its new
 * address.
 */
export function control(address: ControlAddressInput): (element: HTMLElement) => void {
  const registry = useControlRegistry();
  const read = (): ControlAddress | undefined =>
    typeof address === "function" ? address() : address;
  let element: HTMLElement | undefined;

  createEffect(read, (current) => {
    if (!element || !current) return;
    const target = element;
    target.dataset.control = controlKey(current);
    const unregister = registry?.register(current, target);
    return () => {
      unregister?.();
      delete target.dataset.control;
    };
  });

  createEffect(
    (): ControlMark => {
      const current = read();
      return current && registry ? registry.markOf(current) : "none";
    },
    (mark) => {
      if (!element) return;
      if (mark === "none") delete element.dataset.controlMark;
      else element.dataset.controlMark = mark;
    },
  );

  return (el) => {
    element = el;
  };
}
