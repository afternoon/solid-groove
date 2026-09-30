import { describe, expect, it } from "vitest";
import {
  exportFileName,
  FALLBACK_EXPORT_NAME,
  localDateStamp,
  safeFileStem,
} from "./exportFileName";

describe("exportFileName", () => {
  it("is `<project name> <YYYY-MM-DD>.wav` for an ordinary name", () => {
    const date = new Date(2026, 8, 7, 23, 59);
    expect(exportFileName("Night Drive", date, "wav")).toBe("Night Drive 2026-09-07.wav");
  });

  it("dates the file on the local clock, zero-padded", () => {
    expect(localDateStamp(new Date(2027, 0, 3))).toBe("2027-01-03");
  });
});

describe("safeFileStem", () => {
  it("keeps an ordinary name, accents and symbols included, unchanged", () => {
    expect(safeFileStem("Café Beat #2 (D♯ minor)")).toBe("Café Beat #2 (D♯ minor)");
  });

  it("replaces characters a file system refuses and collapses the gaps", () => {
    expect(safeFileStem('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j");
    expect(safeFileStem("tab\there\nnew")).toBe("tab here new");
  });

  it("drops leading and trailing dots and spaces", () => {
    expect(safeFileStem("  ..hidden. ")).toBe("hidden");
  });

  it("falls back to a name when nothing usable is left", () => {
    expect(safeFileStem("")).toBe(FALLBACK_EXPORT_NAME);
    expect(safeFileStem(" / : ")).toBe(FALLBACK_EXPORT_NAME);
    expect(safeFileStem("CON")).toBe(FALLBACK_EXPORT_NAME);
  });

  it("bounds a very long name", () => {
    expect([...safeFileStem("x".repeat(500))]).toHaveLength(120);
  });
});
