import { describe, expect, it } from "vitest";
import { createChromaticKey, type MusicalKey } from "../../domain/musicalKey";
import {
  focusRow,
  HIGHEST_PITCH,
  isBlackKey,
  LOWEST_PITCH,
  pitchName,
  rowIndexOf,
  visibleRows,
} from "./rows";

const C_MINOR: MusicalKey = { root: 0, scale: "minor" };

describe("pitch names", () => {
  it("uses Ableton's numbering, where MIDI 60 is C3", () => {
    expect(pitchName(60)).toBe("C3");
    expect(pitchName(48)).toBe("C2");
    expect(pitchName(51)).toBe("D♯2");
    expect(pitchName(24)).toBe("C0");
    expect(pitchName(96)).toBe("C6");
    expect(pitchName(0)).toBe("C-2");
  });

  it("knows the black keys", () => {
    expect([48, 49, 50, 51, 52, 53, 54].map(isBlackKey)).toEqual([
      false,
      true,
      false,
      true,
      false,
      false,
      true,
    ]);
  });
});

describe("visible rows", () => {
  it("shows C6 down to C0 when chromatic, highest first", () => {
    const rows = visibleRows(createChromaticKey(), []);
    expect(rows).toHaveLength(HIGHEST_PITCH - LOWEST_PITCH + 1);
    expect(rows[0].pitch).toBe(HIGHEST_PITCH);
    expect(rows.at(-1)?.pitch).toBe(LOWEST_PITCH);
    expect(rows.some((row) => row.off)).toBe(false);
  });

  it("shows only scale rows in a scale", () => {
    const rows = visibleRows(C_MINOR, []);
    const octave = rows.filter((row) => row.pitch >= 48 && row.pitch < 60);
    expect(octave.map((row) => pitchName(row.pitch)).reverse()).toEqual([
      "C2",
      "D2",
      "D♯2",
      "F2",
      "G2",
      "G♯2",
      "A♯2",
    ]);
  });

  it("keeps a row that holds an out-of-scale note, marked off", () => {
    const rows = visibleRows(C_MINOR, [48, 54]);
    const fSharp = rows[rowIndexOf(rows, 54)];
    expect(fSharp).toEqual({ pitch: 54, black: true, off: true });
    expect(rows[rowIndexOf(rows, 48)].off).toBe(false);
    expect(rowIndexOf(rows, 52)).toBe(-1);
  });

  it("gives a note outside C0-C6 a row rather than hiding it", () => {
    const rows = visibleRows(createChromaticKey(), [110, 10]);
    expect(rows[0].pitch).toBe(110);
    expect(rows.at(-1)?.pitch).toBe(10);
    // Only the notes' own pitches are added beyond the range.
    expect(rowIndexOf(rows, 109)).toBe(-1);
  });
});

describe("focus row", () => {
  it("opens an empty clip on C3", () => {
    const rows = visibleRows(createChromaticKey(), []);
    expect(rows[focusRow(rows, [])].pitch).toBe(60);
  });

  it("centres on the span the notes cover", () => {
    const rows = visibleRows(createChromaticKey(), [48, 52]);
    expect(focusRow(rows, [48, 52])).toBe(
      (rowIndexOf(rows, 48) + rowIndexOf(rows, 52)) / 2,
    );
  });

  it("falls back to the next row down when the scale has no C3", () => {
    const rows = visibleRows({ root: 1, scale: "major_pentatonic" }, []);
    expect(rows[focusRow(rows, [])].pitch).toBeLessThan(60);
  });
});
