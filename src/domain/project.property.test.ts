import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "./entities";
import {
	bars,
	createAsset,
	createEmptySong,
	createFactoryContext,
	createNoteClip,
	createNoteEvent,
	createPlacement,
	createProjectMetadata,
	createSamplerInstrument,
	createTrack,
} from "./factories";
import { createSeededIdFactory } from "./ids";
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
}

const shapeArbitrary: fc.Arbitrary<ProjectShape> = fc.record({
	seed: fc.integer({ min: 0, max: 1_000_000 }),
	tempo: fc.integer({ min: 20, max: 300 }),
	trackCount: fc.integer({ min: 0, max: 6 }),
	clipBars: fc.integer({ min: 1, max: 4 }),
	notesPerClip: fc.integer({ min: 0, max: 8 }),
	placementsPerTrack: fc.integer({ min: 0, max: 4 }),
});

function buildProject(shape: ProjectShape): Project {
	const context = createFactoryContext({
		ids: createSeededIdFactory(`property-${shape.seed}`),
		now: 1_700_000_000_000,
	});

	const asset = createAsset(context, {
		name: "Generated sample",
		storageRef: `samples/generated/${shape.seed}.wav`,
	});

	const tracks: Track[] = [];
	const clips: Clip[] = [];
	const placements = [];

	for (let index = 0; index < shape.trackCount; index += 1) {
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
						(noteIndex * TICKS_PER_SIXTEENTH) %
						(shape.clipBars * TICKS_PER_BAR),
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

	return {
		metadata: createProjectMetadata(context, {
			ownerId: `user_${shape.seed}`,
			name: `Generated ${shape.seed}`,
		}),
		song: {
			...createEmptySong(shape.tempo),
			assets: [asset],
			tracks,
			placements,
		},
		clips,
	};
}

describe("generated projects", () => {
	it("always satisfy every invariant", () => {
		fc.assert(
			fc.property(shapeArbitrary, (shape) => {
				const result = parseProject(buildProject(shape));
				expect(result.ok, JSON.stringify(result.ok ? [] : result.issues)).toBe(
					true,
				);
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
					expect(serializeProject(result.value)).toEqual(
						serializeProject(project),
					);
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
