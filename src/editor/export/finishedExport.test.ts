import { describe, expect, it } from "vitest";
import type { StemBatch } from "../../export/stems/stemBatches";
import { finishedExport } from "./finishedExport";
import type { TrackLaneView } from "./trackLanes";

const GiB = 1024 ** 3;
const row = (id: string, over: Partial<TrackLaneView> = {}): TrackLaneView => ({
  id,
  name: id,
  color: "#ff0000",
  muted: false,
  fixed: false,
  lanes: [{ startBar: 0, lengthBars: 4 }],
  included: true,
  picked: false,
  ...over,
});
const zip = (index: number, bytes: number): StemBatch => ({
  index,
  paths: ["a.wav"],
  hasMix: index === 0,
  trackIds: [],
  rowIds: [],
  bytes,
  expectedBytes: bytes,
  fits: true,
});
const base = {
  facts: {
    name: "Night Drive",
    length: "2:30",
    tempo: "120 BPM",
    tracks: 3,
    quality: "24-bit · 48 kHz",
  },
  date: new Date(2026, 8, 30),
  bars: 64,
};
const rows = [
  row("a"),
  row("b", { included: false }),
  row("c", { color: "#00ff00" }),
  row("ret", { fixed: true, color: null, lanes: [] }),
];

describe("finishedExport", () => {
  it("reads a stereo mix: one WAV, the tracks in the mix, no returns on the sleeve", () => {
    const finished = finishedExport({
      ...base,
      format: "stereo",
      rows,
      batches: [],
      fileBytes: [300 * 1024 ** 2],
    });
    expect(finished).toMatchObject({
      fileName: "Night Drive 2026-09-30.wav",
      zips: [],
      count: 2,
      size: "300 MiB",
      bars: 64,
    });
    expect(finished.stripes.map((stripe) => stripe.color)).toEqual([
      "#ff0000",
      "#00ff00",
    ]);
  });

  it("reads one ZIP of stems: every stem made, the return counted, none on the sleeve", () => {
    const finished = finishedExport({
      ...base,
      format: "stems",
      rows,
      batches: [zip(0, 0.5 * GiB)],
      fileBytes: [0.5 * GiB],
    });
    expect(finished).toMatchObject({
      fileName: "Night Drive 2026-09-30 stems.zip",
      zips: [],
      count: 3,
      size: "512 MiB",
    });
    expect(finished.stripes).toHaveLength(2);
  });

  it("lists every ZIP with its size when there are several", () => {
    const finished = finishedExport({
      ...base,
      format: "stems",
      rows,
      batches: [zip(0, 1.96 * GiB), zip(1, 1.5 * GiB)],
      fileBytes: [1.96 * GiB, 1.5 * GiB],
    });
    expect(finished.zips).toEqual([
      { name: "Night Drive 2026-09-30 stems 1 of 2.zip", size: "1.96 GiB" },
      { name: "Night Drive 2026-09-30 stems 2 of 2.zip", size: "1.50 GiB" },
    ]);
    expect(finished.size).toBe("3.46 GiB");
  });

  // #836: the finished screen repeated the estimate, not what it had written.
  it("reads the size of the files the export wrote, not the estimate", () => {
    const stereo = finishedExport({
      ...base,
      format: "stereo",
      rows,
      batches: [],
      fileBytes: [2_304_044],
    });
    expect(stereo.size).toBe("2 MiB");
    const stems = finishedExport({
      ...base,
      format: "stems",
      rows,
      batches: [zip(0, 1.9 * GiB), zip(1, 1.9 * GiB)],
      fileBytes: [1.25 * GiB, 0.5 * GiB],
    });
    expect(stems.zips.map((entry) => entry.size)).toEqual(["1.25 GiB", "512 MiB"]);
    expect(stems.size).toBe("1.75 GiB");
  });
});
