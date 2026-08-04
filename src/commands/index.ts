/**
 * The shared command layer (PRD section 9.6).
 *
 * Every project mutation — pointer, keyboard, or assistant — goes through a
 * registered command here. Components never write to project state directly:
 * they build a typed command, hand it to `CommandHistory`, and read the new
 * project back. That gives validation, atomic transactions, one history entry
 * per gesture, deterministic undo/redo, and a human-readable summary of every
 * change in one place instead of once per feature.
 *
 * Nothing in this directory imports Firebase, Tone, or Solid: the kernel is a
 * pure function of domain state, and the editor, the audio engine, the
 * repository, and the assistant all sit outside it.
 */

export * from "./definitions/clips";
export * from "./definitions/deviceChains";
export * from "./definitions/devices";
export * from "./definitions/drum";
export * from "./definitions/instruments";
export * from "./definitions/notes";
export * from "./definitions/packs";
export * from "./definitions/parameters";
export * from "./definitions/placements";
export * from "./definitions/tracks";
export * from "./definitions/transforms";
export * from "./execute";
export * from "./history";
export * from "./projectEdits";
export * from "./registry";
export * from "./types";
