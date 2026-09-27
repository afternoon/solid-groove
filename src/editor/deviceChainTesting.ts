import { createEvent, fireEvent } from "@solidjs/testing-library";
import { fireAndFlush } from "../testing/events";

/**
 * Dragging a device card in a chain's tests, shared by the track chain
 * (`DeviceChainPanel`) and the master's (`MasterPanel`), which are one
 * component.
 */

export const dataTransfer = {
  setData() {},
  getData: () => "",
  effectAllowed: "",
  dropEffect: "",
};

/**
 * Pointer heights for a card's upper and lower half. jsdom lays nothing out,
 * so every card's box is zero-sized at the top of the page: a pointer above
 * its middle is any negative height, one below it any positive one.
 */
export const UPPER = -1;
export const LOWER = 1;

/**
 * A drag event at a pointer height. jsdom has no `DragEvent`, so the event is
 * a plain `Event` and drops `clientY` from its init; it is set on it instead.
 */
export function dragAt(type: "dragOver" | "drop", target: Element, clientY: number) {
  const event = createEvent[type](target, { dataTransfer });
  Object.defineProperty(event, "clientY", { value: clientY });
  fireEvent(target, event);
}

/** A drag of `from`'s card, pressed on `handle`, dropped over one half of `to`. */
export function dragCard(
  from: HTMLElement,
  handle: Element,
  to: HTMLElement,
  clientY = UPPER,
) {
  fireAndFlush(() => {
    fireEvent.pointerDown(handle);
    fireEvent.dragStart(from, { dataTransfer });
    dragAt("dragOver", to, clientY);
    dragAt("drop", to, clientY);
    fireEvent.dragEnd(from, { dataTransfer });
  });
}
