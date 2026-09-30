import { describe, expect, it } from "vitest";
import { buildAudioProjection } from "../../projection/audioProjection";
import { createStemFixtureProject } from "./stemFixture";
import { planStems, REFERENCE_MIX_PATH, safeFileName } from "./stemPlan";

describe("planStems", () => {
  const project = createStemFixtureProject();
  const [lead, bass] = [...project.song.tracks].sort((a, b) => a.order - b.order);
  const [verb, delay] = [...project.song.returns].sort((a, b) => a.order - b.order);
  const plan = planStems(project);
  const byPath = new Map(plan.map((stem) => [stem.path, stem]));

  it("lists tracks in track order, then returns under Returns/, then the reference mix", () => {
    expect(plan.map((stem) => stem.path)).toEqual([
      "01 Lead.wav",
      "02 Sub Bass.wav",
      "Returns/01 Verb.wav",
      "Returns/02 Delay.wav",
      REFERENCE_MIX_PATH,
    ]);
    expect(plan.map((stem) => stem.kind)).toEqual([
      "track",
      "track",
      "return",
      "return",
      "mix",
    ]);
    expect(plan.map((stem) => stem.sourceId)).toEqual([
      lead.id,
      bass.id,
      verb.id,
      delay.id,
      undefined,
    ]);
  });

  it("is deterministic", () => {
    expect(planStems(project).map((stem) => stem.path)).toEqual(
      plan.map((stem) => stem.path),
    );
  });

  it("renders a track stem as that track alone, unmuted, without sends or master processing", () => {
    const stem = byPath.get("02 Sub Bass.wav");
    const projection = stem?.projection;
    expect(stem?.tracksSendOnly).toBe(false);
    expect(projection?.tracks.map((track) => track.id)).toEqual([bass.id]);
    const track = projection?.tracksById.get(bass.id);
    expect(track?.mixer).toMatchObject({ muted: false, soloed: false });
    expect(track?.mixer.volume).toBe(bass.mixer.volume);
    expect(track?.mixer.pan).toBe(bass.mixer.pan);
    expect(track?.sendConfig).toEqual([]);
    expect(projection?.returns).toEqual([]);
    expect(projection?.master.devices).toEqual([]);
    expect(projection?.master.volume).toBe(0);
    expect(projection?.placements.map((p) => p.trackId)).toEqual([bass.id]);
    expect(projection?.clips.map((clip) => clip.trackId)).toEqual([bass.id]);
    expect([...(projection?.clipsById.keys() ?? [])]).toEqual(
      projection?.clips.map((clip) => clip.id),
    );
    // Carried for ARR-004 (#62); until it lands the stem plays the static fader.
    expect(projection?.automation.map((lane) => lane.id)).toEqual(["aut_bass"]);
  });

  it("keeps a track's inserts and instrument in its stem", () => {
    const mix = buildAudioProjection(project);
    const stem = byPath.get("01 Lead.wav")?.projection.tracksById.get(lead.id);
    expect(stem?.instrument).toEqual(mix.tracksById.get(lead.id)?.instrument);
    expect(stem?.devices).toHaveLength(1);
    expect(stem?.devices).toEqual(mix.tracksById.get(lead.id)?.devices);
  });

  it("renders a return stem from every track's send to it, with dry outputs silenced", () => {
    const stem = byPath.get("Returns/01 Verb.wav");
    const projection = stem?.projection;
    expect(stem?.tracksSendOnly).toBe(true);
    expect(projection?.returns.map((bus) => bus.id)).toEqual([verb.id]);
    expect(projection?.tracks).toHaveLength(2);
    for (const track of projection?.tracks ?? []) {
      expect(track.sendConfig.every((send) => send.returnId === verb.id)).toBe(true);
      expect(track.mixer).toMatchObject({ muted: false, soloed: false });
    }
    expect(projection?.tracksById.get(lead.id)?.sendConfig).toHaveLength(1);
    expect(projection?.tracksById.get(bass.id)?.sendConfig).toEqual([]);
    expect(projection?.master.devices).toEqual([]);
    expect(projection?.placements).toHaveLength(2);
    expect(projection?.automation.map((lane) => lane.id).sort()).toEqual([
      "aut_bass",
      "aut_lead",
      "aut_send",
      "aut_verb",
    ]);
  });

  it("renders the reference mix as the song plays: master processing and mute/solo kept", () => {
    const mix = byPath.get(REFERENCE_MIX_PATH)?.projection;
    expect(mix).toEqual(buildAudioProjection(project));
    expect(mix?.master.devices).toHaveLength(1);
    expect(mix?.tracksById.get(bass.id)?.mixer.muted).toBe(true);
  });

  it("numbers wide enough that a hundred tracks still sort in order", () => {
    const tracks = Array.from({ length: 100 }, (_, order) => ({
      ...lead,
      id: `trk_${String(order).padStart(3, "0")}` as typeof lead.id,
      order,
    }));
    const song = { ...project.song, tracks, placements: [], returns: [], automation: [] };
    const paths = planStems({ ...project, song, clips: [] }).map((stem) => stem.path);
    const stems = paths.slice(0, 100);
    expect([stems[0], stems[99]]).toEqual(["001 Lead.wav", "100 Lead.wav"]);
    expect([...stems].sort()).toEqual(stems);
  });
});

describe("safeFileName", () => {
  it("replaces characters a file system rejects, trims what Windows drops, never empties", () => {
    expect(safeFileName('Kick: "Big" <1>?')).toBe("Kick Big 1");
    expect(safeFileName("a\\b/c|d*e")).toBe("a b c d e");
    expect(safeFileName("  ..hidden. ")).toBe("hidden");
    expect(safeFileName("tab\there\u0000")).toBe("tab here");
    expect(safeFileName("///")).toBe("Untitled");
  });
});
