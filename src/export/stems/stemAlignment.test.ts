import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installWebAudioGlobals } from "../../audio/testAudioContext";
import { TICKS_PER_BAR, ticksToSeconds, toTicks } from "../../domain/time";
import type { AudioSongProjection } from "../../projection/audioProjection";
import { createStemFixtureProject } from "./stemFixture";
import { planStems } from "./stemPlan";

// Must run before Tone is imported — see AudioRuntime.test.ts for why.
installWebAudioGlobals();

let renderer: typeof import("../../audio/offlineRenderer");
let runtime: typeof import("../../audio/AudioRuntime");

beforeAll(async () => {
  renderer = await import("../../audio/offlineRenderer");
  runtime = await import("../../audio/AudioRuntime");
});

afterEach(async () => {
  await runtime.getAudioRuntime().close();
  runtime.__resetAudioRuntimeForTests();
});

/** The first frame any channel is audible in. */
function onsetFrame(channels: readonly Float32Array[]): number {
  const frames = channels[0].length;
  for (let i = 0; i < frames; i++) {
    if (channels.some((data) => Math.abs(data[i]) > 1e-4)) return i;
  }
  return -1;
}

describe("stem alignment through the real offline renderer", () => {
  it("starts a track stem on the same frame as the reference mix", async () => {
    // Lead is soloed, so the reference mix is Lead alone through the master.
    // Its clips move a bar later, so the onset is well away from frame 0.
    const project = createStemFixtureProject();
    const lead = project.song.tracks.find((track) => track.mixer.soloed);
    const placements = project.song.placements.map((p) =>
      p.trackId === lead?.id
        ? { ...p, startTicks: toTicks(p.startTicks + TICKS_PER_BAR) }
        : p,
    );
    const plan = planStems({ ...project, song: { ...project.song, placements } });
    const render = (projection: AudioSongProjection) =>
      renderer.renderProjectOffline(projection, {
        sampleRate: 8_000,
        maxTailSeconds: 0.25,
      });
    const stem = await render(plan[0].projection);
    const mix = await render(plan[plan.length - 1].projection);
    expect(plan[0].sourceId).toBe(lead?.id);
    // Bar 2 at the fixture's tempo, give or take the synth's attack.
    const bar2 = Math.round(ticksToSeconds(TICKS_PER_BAR, project.song.tempo) * 8_000);
    const onset = onsetFrame(stem.channels);
    expect(onset - bar2).toBeGreaterThanOrEqual(0);
    expect(onset - bar2).toBeLessThan(8);
    expect(onsetFrame(mix.channels)).toBe(onset);
  });
});
