import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Asset, Clip, Project, Track } from "./entities";
import {
  bars,
  createAsset,
  createEmptySong,
  createFactoryContext,
  createNoteClip,
  createNoteEvent,
  createPack,
  createPlacement,
  createProjectMetadata,
  createSamplerInstrument,
  createTrack,
} from "./factories";
import { createSeededIdFactory } from "./ids";
import { derivePackDependencies, resolvePackAvailability } from "./packs";
import { parseProject } from "./parse";
import { serializeProject, stringifyProject } from "./serialize";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from "./time";

/**
 * Property-oriented coverage: rather than one hand-written example per rule,
 * these generate whole projects and assert that validation and serialization
 * hold for every shape the generator produces. The seed is fixed so a failure
 * is reproducible.
 */

const RUN_OPTIONS = { numRuns: 100, seed: 20_260_724 } as const;

interface ProjectShape {
  seed: number;
  tempo: number;
  trackCount: number;
  clipBars: number;
  notesPerClip: number;
  placementsPerTrack: number;
  /**
   * How many packs the generated assets are spread across. Varying it is what
   * makes invariant 12 property-tested rather than example-tested: a
   * single-pack generator would pass even if pack qualification were ignored.
   */
  packCount: number;
}

const shapeArbitrary: fc.Arbitrary<ProjectShape> = fc.record({
  seed: fc.integer({ min: 0, max: 1_000_000 }),
  tempo: fc.integer({ min: 20, max: 300 }),
  trackCount: fc.integer({ min: 0, max: 6 }),
  clipBars: fc.integer({ min: 1, max: 4 }),
  notesPerClip: fc.integer({ min: 0, max: 8 }),
  placementsPerTrack: fc.integer({ min: 0, max: 4 }),
  packCount: fc.integer({ min: 1, max: 3 }),
});

function buildProject(shape: ProjectShape): Project {
  const context = createFactoryContext({
    ids: createSeededIdFactory(`property-${shape.seed}`),
    now: 1_700_000_000_000,
  });

  // One asset per pack, so an n-pack project has n dependencies and each track
  // resolves through a different one.
  const assets: Asset[] = Array.from({ length: shape.packCount }, (_, index) =>
    createAsset(context, {
      pack: createPack(context, {
        name: `Generated pack ${index + 1}`,
        version: `1.${index}.0`,
      }),
      name: `Generated sample ${index + 1}`,
      storageRef: `samples/generated/${shape.seed}-${index}.wav`,
    }),
  );

  const tracks: Track[] = [];
  const clips: Clip[] = [];
  const placements = [];

  for (let index = 0; index < shape.trackCount; index += 1) {
    const asset = assets[index % assets.length];
    const track = createTrack(context, {
      name: `Track ${index + 1}`,
      order: index,
      instrument: createSamplerInstrument(asset.id),
    });
    tracks.push(track);

    const clip = createNoteClip(context, {
      trackId: track.id,
      name: `Clip ${index + 1}`,
      lengthTicks: shape.clipBars * TICKS_PER_BAR,
      events: Array.from({ length: shape.notesPerClip }, (_, noteIndex) =>
        createNoteEvent(context, {
          startTicks:
            (noteIndex * TICKS_PER_SIXTEENTH) % (shape.clipBars * TICKS_PER_BAR),
          durationTicks: TICKS_PER_SIXTEENTH,
          pitch: 36 + (noteIndex % 12),
          velocity: 0.1 + (noteIndex % 9) / 10,
        }),
      ),
    });
    clips.push(clip);

    for (let slot = 0; slot < shape.placementsPerTrack; slot += 1) {
      placements.push(
        createPlacement(context, {
          clipId: clip.id,
          trackId: track.id,
          startTicks: bars(slot * shape.clipBars),
          durationTicks: bars(shape.clipBars),
        }),
      );
    }
  }

  const song = {
    ...createEmptySong(shape.tempo),
    assets,
    tracks,
    placements,
  };

  return {
    metadata: createProjectMetadata(context, {
      ownerId: `user_${shape.seed}`,
      name: `Generated ${shape.seed}`,
      packDependencies: derivePackDependencies(song),
    }),
    song,
    clips,
  };
}

describe("generated projects", () => {
  it("always satisfy every invariant", () => {
    fc.assert(
      fc.property(shapeArbitrary, (shape) => {
        const result = parseProject(buildProject(shape));
        expect(result.ok, JSON.stringify(result.ok ? [] : result.issues)).toBe(true);
      }),
      RUN_OPTIONS,
    );
  });

  it("round trip through JSON without changing their serialization", () => {
    fc.assert(
      fc.property(shapeArbitrary, (shape) => {
        const project = buildProject(shape);
        const json = JSON.parse(stringifyProject(project));
        const result = parseProject(json);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(serializeProject(result.value)).toEqual(serializeProject(project));
        }
      }),
      RUN_OPTIONS,
    );
  });

  it("report an issue, never throw, when a referenced entity disappears", () => {
    fc.assert(
      fc.property(
        shapeArbitrary.filter((shape) => shape.trackCount > 0),
        (shape) => {
          const project = buildProject(shape);
          const broken = {
            ...project,
            song: { ...project.song, tracks: project.song.tracks.slice(1) },
          };
          const result = parseProject(broken);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.issues.length).toBeGreaterThan(0);
          }
        },
      ),
      RUN_OPTIONS,
    );
  });

  it("reject arbitrary non-project values without throwing", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(parseProject(value).ok).toBe(false);
      }),
      RUN_OPTIONS,
    );
  });
});

/** Invariant 12, over generated projects spanning one to three packs. */
describe("generated projects and their packs", () => {
  it("declare exactly the packs their assets resolve from", () => {
    fc.assert(
      fc.property(shapeArbitrary, (shape) => {
        const project = buildProject(shape);
        expect(project.metadata.packDependencies).toHaveLength(shape.packCount);
        expect(project.metadata.packDependencies).toEqual(
          derivePackDependencies(project.song),
        );
      }),
      RUN_OPTIONS,
    );
  });

  it("are rejected when an asset resolves from an undeclared pack", () => {
    fc.assert(
      fc.property(shapeArbitrary, (shape) => {
        const project = buildProject(shape);
        const result = parseProject({
          ...project,
          metadata: {
            ...project.metadata,
            packDependencies: project.metadata.packDependencies.slice(1),
          },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(
            result.issues.some((issue) => issue.code === "invalid_pack_reference"),
          ).toBe(true);
        }
      }),
      RUN_OPTIONS,
    );
  });

  it("are rejected when a declared pack version disagrees with its assets", () => {
    fc.assert(
      fc.property(shapeArbitrary, (shape) => {
        const project = buildProject(shape);
        const [first, ...rest] = project.metadata.packDependencies;
        const result = parseProject({
          ...project,
          metadata: {
            ...project.metadata,
            packDependencies: [{ ...first, version: "9.9.9" }, ...rest],
          },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(
            result.issues.some((issue) => issue.code === "invalid_pack_reference"),
          ).toBe(true);
        }
      }),
      RUN_OPTIONS,
    );
  });

  it("report every missing pack rather than throwing, for any subset of available packs", () => {
    fc.assert(
      fc.property(shapeArbitrary, fc.nat(), (shape, availableCount) => {
        const project = buildProject(shape);
        const available = project.metadata.packDependencies
          .slice(0, availableCount % (shape.packCount + 1))
          .map((dependency, index) => ({
            pack: {
              id: dependency.packId,
              name: `Generated pack ${index + 1}`,
              version: dependency.version,
              publisher: "Solid Groove",
              kind: "factory" as const,
              description: "",
              rights: {
                licence: "solid-groove-owned",
                rawRedistribution: true,
                attributionRequired: false,
              },
            },
            // Every pack the caller holds still holds all of its own assets, so
            // the only thing this property varies is which packs are present.
            assetIds: project.song.assets
              .filter((asset) => asset.packId === dependency.packId)
              .map((asset) => asset.id),
          }));

        const report = resolvePackAvailability(project, available);

        expect(report.missing).toHaveLength(
          project.metadata.packDependencies.length - available.length,
        );
        expect(report.missingAssets).toEqual([]);
        expect(report.satisfied).toBe(report.missing.length === 0);
        // The project itself is untouched: no substitution, no repair.
        expect(parseProject(project).ok).toBe(true);
      }),
      RUN_OPTIONS,
    );
  });
});
