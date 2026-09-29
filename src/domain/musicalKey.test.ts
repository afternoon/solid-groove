import { describe, expect, it } from "vitest";
import {
  createChromaticKey,
  isPitchInKey,
  type MusicalKey,
  nearestPitchInKey,
  SCALE_IDS,
  SCALE_INTERVALS,
} from "./musicalKey";

const C_MINOR: MusicalKey = { root: 0, scale: "minor" };
const D_MAJOR: MusicalKey = { root: 2, scale: "major" };

describe("musical key", () => {
  it("offers the nine scales the piano roll lists, each starting on its root", () => {
    expect(SCALE_IDS).toHaveLength(9);
    for (const scale of SCALE_IDS) expect(SCALE_INTERVALS[scale][0]).toBe(0);
  });

  it("holds every pitch in a chromatic key", () => {
    const key = createChromaticKey();
    for (let pitch = 0; pitch < 24; pitch += 1) {
      expect(isPitchInKey(key, pitch)).toBe(true);
    }
  });

  it("measures membership from the root, in every octave", () => {
    // D major: D E F# G A B C#.
    expect(isPitchInKey(D_MAJOR, 62)).toBe(true); // D
    expect(isPitchInKey(D_MAJOR, 66)).toBe(true); // F#
    expect(isPitchInKey(D_MAJOR, 65)).toBe(false); // F
    expect(isPitchInKey(D_MAJOR, 1)).toBe(true); // C#, lowest octave
    expect(isPitchInKey(C_MINOR, 51)).toBe(true); // D#
    expect(isPitchInKey(C_MINOR, 52)).toBe(false); // E
  });

  it("leaves a pitch in the key where it is", () => {
    expect(nearestPitchInKey(C_MINOR, 55)).toBe(55);
  });

  it("moves a stray pitch to the nearest scale pitch", () => {
    // B (59) is one semitone from C (60) and one from A# (58): a tie, so down.
    expect(nearestPitchInKey(C_MINOR, 59)).toBe(58);
    // C# (61) is one from C (60) and one from D (62).
    expect(nearestPitchInKey(C_MINOR, 61)).toBe(60);
    // In C major pentatonic, F (65) is one from E (64) and two from G (67).
    expect(nearestPitchInKey({ root: 0, scale: "major_pentatonic" }, 65)).toBe(64);
    // B (71) is two from A (69) and one from C (72).
    expect(nearestPitchInKey({ root: 0, scale: "major_pentatonic" }, 71)).toBe(72);
  });

  it("rounds a tie down", () => {
    // F# (54) sits between F (53) and G (55).
    expect(nearestPitchInKey(C_MINOR, 54)).toBe(53);
    // E (52) sits between D# (51) and F (53).
    expect(nearestPitchInKey(C_MINOR, 52)).toBe(51);
  });

  it("never leaves the allowed range to find a scale pitch", () => {
    // C# at the bottom of the range can only go up.
    expect(nearestPitchInKey(C_MINOR, 1, 1, 127)).toBe(2);
    // F# (126) in C major pentatonic is nearest G (127), which is out of range.
    const pentatonic: MusicalKey = { root: 0, scale: "major_pentatonic" };
    expect(nearestPitchInKey(pentatonic, 126)).toBe(127);
    expect(nearestPitchInKey(pentatonic, 126, 0, 126)).toBe(124);
  });
});
