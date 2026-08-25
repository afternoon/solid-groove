import { describe, expect, it } from "vitest";
import {
  type ChordEvent,
  chordLabel,
  detectPlatform,
  isShiftAmbiguous,
  keyLabel,
  matchesChord,
  normalizeKey,
  parseChord,
  specLabel,
} from "./keys";

function keyEvent(key: string, modifiers: Partial<ChordEvent> = {}): ChordEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

describe("parseChord", () => {
  it("resolves Mod to Cmd on macOS and Ctrl elsewhere", () => {
    expect(parseChord("Mod+Z", "mac")).toEqual({
      key: "z",
      mod: true,
      ctrl: false,
      alt: false,
      shift: false,
    });
    expect(parseChord("Mod+Z", "other").mod).toBe(true);
  });

  it("keeps Ctrl distinct from Cmd on macOS, but the same off it", () => {
    expect(parseChord("Ctrl+Z", "mac")).toMatchObject({
      mod: false,
      ctrl: true,
    });
    expect(parseChord("Ctrl+Z", "other")).toMatchObject({
      mod: true,
      ctrl: false,
    });
  });

  it("parses Space, named keys, and a literal + key", () => {
    expect(parseChord("Space", "other").key).toBe(" ");
    expect(parseChord("Shift+Space", "other")).toMatchObject({
      key: " ",
      shift: true,
    });
    expect(parseChord("Escape", "other").key).toBe("escape");
    expect(parseChord("+", "other").key).toBe("+");
    expect(parseChord("Mod++", "other")).toMatchObject({ key: "+", mod: true });
  });

  it("rejects a chord with no key", () => {
    expect(() => parseChord("Mod+", "other")).toThrow(/no key/);
  });
});

describe("matchesChord", () => {
  it("matches the character the layout produced, not a physical key code", () => {
    // `?` is Shift+/ on US, an unshifted key on others, and AltGr elsewhere
    // again. Matching the produced character is what makes all three work.
    const chord = parseChord("?", "other");
    expect(matchesChord(chord, keyEvent("?", { shiftKey: true }), "other")).toBe(true);
    expect(matchesChord(chord, keyEvent("?"), "other")).toBe(true);
    expect(matchesChord(chord, keyEvent("/"), "other")).toBe(false);
  });

  it("matches letters case-insensitively but keeps Shift significant", () => {
    const chord = parseChord("E", "other");
    expect(matchesChord(chord, keyEvent("e"), "other")).toBe(true);
    expect(matchesChord(chord, keyEvent("E", { shiftKey: true }), "other")).toBe(false);
  });

  it("separates Space from Shift+Space", () => {
    const play = parseChord("Space", "other");
    const contin = parseChord("Shift+Space", "other");
    expect(matchesChord(play, keyEvent(" "), "other")).toBe(true);
    expect(matchesChord(play, keyEvent(" ", { shiftKey: true }), "other")).toBe(false);
    expect(matchesChord(contin, keyEvent(" ", { shiftKey: true }), "other")).toBe(true);
  });

  it("does not let the wrong primary modifier through", () => {
    const chord = parseChord("Mod+Z", "mac");
    expect(matchesChord(chord, keyEvent("z", { metaKey: true }), "mac")).toBe(true);
    expect(matchesChord(chord, keyEvent("z", { ctrlKey: true }), "mac")).toBe(false);
    const other = parseChord("Mod+Z", "other");
    expect(matchesChord(other, keyEvent("z", { metaKey: true }), "other")).toBe(false);
  });

  it("distinguishes Mod+Z from Mod+Shift+Z", () => {
    const undo = parseChord("Mod+Z", "mac");
    const redo = parseChord("Mod+Shift+Z", "mac");
    const event = keyEvent("Z", { metaKey: true, shiftKey: true });
    expect(matchesChord(undo, event, "mac")).toBe(false);
    expect(matchesChord(redo, event, "mac")).toBe(true);
  });

  it("requires Alt to match exactly", () => {
    const chord = parseChord("Mod+D", "other");
    expect(
      matchesChord(chord, keyEvent("d", { ctrlKey: true, altKey: true }), "other"),
    ).toBe(false);
  });
});

describe("labels", () => {
  it("uses Cmd/Option on macOS and Ctrl/Alt elsewhere", () => {
    expect(specLabel("Mod+Shift+Z", "mac")).toBe("Cmd+Shift+Z");
    expect(specLabel("Mod+Shift+Z", "other")).toBe("Ctrl+Shift+Z");
    expect(specLabel("Alt+E", "mac")).toBe("Option+E");
    expect(specLabel("Alt+E", "other")).toBe("Alt+E");
  });

  it("names keys that are not printable characters", () => {
    expect(keyLabel(" ")).toBe("Space");
    expect(keyLabel("escape")).toBe("Escape");
    expect(keyLabel("z")).toBe("Z");
    expect(keyLabel("?")).toBe("?");
    expect(chordLabel(parseChord("Shift+Space", "mac"), "mac")).toBe("Shift+Space");
  });
});

describe("helpers", () => {
  it("normalizes aliases", () => {
    expect(normalizeKey("Space")).toBe(" ");
    expect(normalizeKey("Esc")).toBe("escape");
    expect(normalizeKey("Q")).toBe("q");
  });

  it("treats punctuation as shift-ambiguous and letters as not", () => {
    expect(isShiftAmbiguous("?")).toBe(true);
    expect(isShiftAmbiguous("+")).toBe(true);
    expect(isShiftAmbiguous("z")).toBe(false);
    expect(isShiftAmbiguous(" ")).toBe(false);
    expect(isShiftAmbiguous("escape")).toBe(false);
  });

  it("detects the platform from the navigator, defaulting to other", () => {
    expect(detectPlatform({ platform: "MacIntel" } as Navigator)).toBe("mac");
    expect(
      detectPlatform({
        userAgentData: { platform: "macOS" },
        platform: "",
      } as unknown as Navigator),
    ).toBe("mac");
    expect(detectPlatform({ platform: "Win32" } as Navigator)).toBe("other");
    expect(detectPlatform(undefined)).toBe("other");
  });
});
