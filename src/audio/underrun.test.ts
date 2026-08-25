import { describe, expect, it } from "vitest";
import { UnderrunMonitor, type UnderrunReport } from "./underrun";

describe("UnderrunMonitor (PRD AUD-03/OPS-02)", () => {
  function collect(
    options: Partial<{
      contextSampleRate: number;
      samplingRate: number;
      toleranceSeconds: number;
    }> = {},
  ): { monitor: UnderrunMonitor; reports: UnderrunReport[] } {
    const reports: UnderrunReport[] = [];
    const monitor = new UnderrunMonitor({
      contextSampleRate: options.contextSampleRate ?? 48_000,
      samplingRate: options.samplingRate ?? 0.1,
      toleranceSeconds: options.toleranceSeconds ?? 0.02,
      emit: (report) => reports.push(report),
    });
    return { monitor, reports };
  }

  it("an event that fires on time or early is never a drop", () => {
    const { monitor, reports } = collect({ samplingRate: 1 });
    // Actual audio time is before the intended time — scheduled ahead, good.
    monitor.observe(10, 9.5);
    // Within tolerance.
    monitor.observe(10, 10.01);
    expect(reports).toHaveLength(0);
  });

  it("emits nothing until the sampling threshold is crossed, then one report", () => {
    // 1 report per 10 drops.
    const { monitor, reports } = collect({ samplingRate: 0.1 });
    for (let i = 0; i < 9; i += 1) monitor.observe(1, 2);
    expect(reports).toHaveLength(0);
    monitor.observe(1, 2); // the 10th drop
    expect(reports).toHaveLength(1);
  });

  it("records the sample rate as an enumerated key and buckets the dropped count", () => {
    const { monitor, reports } = collect({
      samplingRate: 1,
      contextSampleRate: 44_100,
    });
    monitor.observe(1, 2);
    expect(reports[0]).toEqual({
      // One drop lands in the "1_4" dropped_events bucket.
      droppedEventBucket: "1_4",
      sampleRate: "44100",
    });
  });

  it("maps an unusual sample rate to the 'other' key", () => {
    const { monitor, reports } = collect({
      samplingRate: 1,
      contextSampleRate: 22_050,
    });
    monitor.observe(1, 2);
    expect(reports[0]?.sampleRate).toBe("other");
  });

  it("resets its window after a report so counts do not carry over", () => {
    const { monitor, reports } = collect({ samplingRate: 0.5 }); // 1 per 2 drops
    monitor.observe(1, 2);
    monitor.observe(1, 2); // report #1
    monitor.observe(1, 2);
    monitor.observe(1, 2); // report #2
    expect(reports).toHaveLength(2);
    expect(reports.every((r) => r.droppedEventBucket === "1_4")).toBe(true);
  });
});
