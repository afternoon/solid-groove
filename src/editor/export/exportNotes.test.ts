import { describe, expect, it } from "vitest";
import { stemsNote } from "./exportNotes";

describe("stemsNote", () => {
  const GiB = 1024 ** 3;

  it("says to turn a track on when none is", () => {
    expect(stemsNote({ tracks: 0, zips: 1, bytes: 0 })).toBe(
      "Turn on at least one track to export stems.",
    );
  });

  it("names the size and the number of ZIPs when the stems are over the limit", () => {
    expect(stemsNote({ tracks: 50, zips: 3, bytes: 4.57 * GiB })).toBe(
      "4.57 GiB is over the 2 GiB browser limit, so stems come as 3 ZIPs in track order, each downloaded when ready.",
    );
  });

  it("says the stems fit in one ZIP", () => {
    expect(stemsNote({ tracks: 5, zips: 1, bytes: 0.5 * GiB })).toBe(
      "Stems over 2 GiB come as several ZIPs in track order. These fit in one.",
    );
  });
});
