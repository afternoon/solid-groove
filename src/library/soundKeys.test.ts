import { afterEach, describe, expect, it } from "vitest";
import { focusKeepsKey } from "./soundKeys";

// #860: the library's Enter and Space act on the selected sound unless a
// control that answers those keys itself has focus.
describe("focusKeepsKey", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const focus = (html: string): Element => {
    document.body.innerHTML = html;
    const element = document.body.firstElementChild as HTMLElement;
    element.focus();
    return element;
  };

  it("leaves the keys to the library when nothing is focused", () => {
    expect(focusKeepsKey(document.body)).toBe(false);
    expect(focusKeepsKey(null)).toBe(false);
  });

  it("gives them to a rail button, a chip, a tab and a checkbox", () => {
    expect(
      focusKeepsKey(focus('<button class="library-modal-rail-item">Packs</button>')),
    ).toBe(true);
    expect(focusKeepsKey(focus('<button aria-pressed="false">Kick</button>'))).toBe(true);
    expect(focusKeepsKey(focus('<div role="tab" tabindex="0">Drums</div>'))).toBe(true);
    expect(focusKeepsKey(focus('<input type="checkbox">'))).toBe(true);
  });

  it("keeps them for the library on a sound row, Insert, and the parked close button", () => {
    expect(focusKeepsKey(focus('<button class="sound-row-main">Kick</button>'))).toBe(
      false,
    );
    expect(
      focusKeepsKey(focus('<button class="library-modal-insert">Insert</button>')),
    ).toBe(false);
    expect(focusKeepsKey(focus('<button class="dialog-close">Close</button>'))).toBe(
      false,
    );
  });

  it("reads the focused element by default", () => {
    focus('<button class="library-modal-rail-item">Packs</button>');
    expect(focusKeepsKey()).toBe(true);
  });
});
