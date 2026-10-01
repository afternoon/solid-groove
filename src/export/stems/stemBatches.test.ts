import { describe, expect, it } from "vitest";
import { estimateStemExport } from "./exportStems";
import { planStemBatches } from "./stemBatches";
import { createStemFixtureProject } from "./stemFixture";
import { planStems } from "./stemPlan";

const RATE = 8_000;
const project = createStemFixtureProject();
const whole = estimateStemExport(project, { sampleRate: RATE });
const plan = planStems(project);
const todayPaths = plan.map((stem) => stem.path);
const trackStems = plan.filter((stem) => stem.kind === "track");
const trackIds = [...project.song.tracks]
  .sort((a, b) => a.order - b.order)
  .map((track) => track.id);

/** A budget that holds `n` of the five stems, and not one more. */
const budgetFor = (n: number) => Math.floor((whole.bytes / 5) * (n + 0.5));

describe("planStemBatches", () => {
  it("is one batch, with today's files, when everything fits", () => {
    const batches = planStemBatches(project, { sampleRate: RATE });
    expect(batches).toHaveLength(1);
    expect([...batches[0].paths].sort()).toEqual([...todayPaths].sort());
    expect(batches[0]).toMatchObject({ index: 0, hasMix: true, bytes: whole.bytes });
    expect(batches[0].trackIds).toEqual(trackIds);
  });

  it("splits in order: mix first, tracks, then returns, each under budget", () => {
    const maxBytes = budgetFor(2);
    const batches = planStemBatches(project, { sampleRate: RATE, maxBytes });
    expect(batches.map((batch) => batch.index)).toEqual([0, 1, 2]);
    expect(batches.map((batch) => batch.hasMix)).toEqual([true, false, false]);
    expect(batches.every((batch) => batch.fits && batch.bytes <= maxBytes)).toBe(true);
    const packed = batches.flatMap((batch) => batch.paths);
    expect(packed).toEqual([
      "Reference mix.wav",
      ...trackStems.map((stem) => stem.path),
      ...plan.filter((stem) => stem.kind === "return").map((stem) => stem.path),
    ]);
    expect(batches.flatMap((batch) => batch.trackIds)).toEqual(trackIds);
    // The returns ride in the last ZIPs, after every track.
    const rows = batches.flatMap((batch) => batch.rowIds);
    expect(rows.slice(0, trackIds.length)).toEqual(trackIds);
    expect(rows.length).toBe(trackIds.length + project.song.returns.length);
  });

  it("keeps each track's whole-song number when only some are selected", () => {
    const batches = planStemBatches(project, {
      sampleRate: RATE,
      trackIds: [trackIds[1]],
      maxBytes: budgetFor(2),
    });
    const paths = batches.flatMap((batch) => batch.paths);
    expect(paths).toContain(trackStems[1].path);
    expect(paths).not.toContain(trackStems[0].path);
    expect(batches.flatMap((batch) => batch.trackIds)).toEqual([trackIds[1]]);
  });

  it("plans the mix and returns alone when no track is selected", () => {
    const batches = planStemBatches(project, { sampleRate: RATE, trackIds: [] });
    expect(batches).toHaveLength(1);
    expect(batches[0].trackIds).toEqual([]);
    expect(batches[0].paths).toHaveLength(3);
  });

  it("gives a stem over the budget by itself a batch of its own that does not fit", () => {
    const batches = planStemBatches(project, { sampleRate: RATE, maxBytes: 1 });
    expect(batches).toHaveLength(5);
    expect(batches.every((batch) => batch.paths.length === 1 && !batch.fits)).toBe(true);
  });
});
