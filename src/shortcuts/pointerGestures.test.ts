import { describe, expect, it } from "vitest";
import {
  POINTER_MODIFIER_IDS,
  POINTER_MODIFIERS,
  pointerModifierById,
  pointerModifierHeld,
  pointerModifierLabel,
  suppressModifierDefault,
} from "./pointerGestures";

const NONE = { altKey: false, shiftKey: false, metaKey: false, ctrlKey: false };

function key(type: "keydown" | "keyup", name: string): KeyboardEvent {
  return new KeyboardEvent(type, { key: name, cancelable: true });
}

describe("pointer modifiers", () => {
  it("registers each ID exactly once", () => {
    expect(POINTER_MODIFIERS.map((entry) => entry.id)).toEqual([...POINTER_MODIFIER_IDS]);
  });

  it("reads the Alt/Option drag-copy off the event, on both platforms", () => {
    for (const platform of ["mac", "other"] as const) {
      expect(pointerModifierHeld("arrangement.drag_copy", NONE, platform)).toBe(false);
      expect(
        pointerModifierHeld("arrangement.drag_copy", { ...NONE, altKey: true }, platform),
      ).toBe(true);
      // Shift and Cmd/Ctrl stay undefined for a drag (CF-015).
      for (const other of ["shiftKey", "metaKey", "ctrlKey"] as const) {
        expect(
          pointerModifierHeld(
            "arrangement.drag_copy",
            { ...NONE, [other]: true },
            platform,
          ),
        ).toBe(false);
      }
    }
  });

  it("labels it with each platform's modifier name", () => {
    const copy = pointerModifierById("arrangement.drag_copy");
    expect(pointerModifierLabel(copy, "mac")).toBe("Option+drag");
    expect(pointerModifierLabel(copy, "other")).toBe("Alt+drag");
  });

  it("records its relation to Ableton Live, naming Live's keys", () => {
    const { ableton } = pointerModifierById("arrangement.drag_copy");
    expect(ableton.kind).toBe("differs");
    if (ableton.kind === "differs") expect(ableton.abletonKeys).toContain("Option-drag");
  });
});

describe("suppressModifierDefault", () => {
  it("cancels the bare modifier while attached, and only that key", () => {
    const target = new EventTarget();
    const stop = suppressModifierDefault("arrangement.drag_copy", target);
    const down = key("keydown", "Alt");
    const up = key("keyup", "Alt");
    const arrow = key("keydown", "ArrowUp");
    target.dispatchEvent(down);
    target.dispatchEvent(arrow);
    target.dispatchEvent(up);
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
    expect(arrow.defaultPrevented).toBe(false);

    stop();
    const after = key("keyup", "Alt");
    target.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("stopped while held, it also cancels the release, then lets go", () => {
    const target = new EventTarget();
    const stop = suppressModifierDefault("arrangement.drag_copy", target);
    stop(true);
    const release = key("keyup", "Alt");
    target.dispatchEvent(release);
    expect(release.defaultPrevented).toBe(true);

    const next = key("keydown", "Alt");
    target.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
  });
});
