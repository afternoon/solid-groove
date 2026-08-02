import type { Project, Song } from "../domain/entities";
import {
	createEmptySong,
	createFactoryContext,
	createNoteClip,
	createNoteEvent,
	createPlacement,
	createProjectMetadata,
	createSamplerInstrument,
	createTrack,
} from "../domain/factories";
import { derivePackDependencies } from "../domain/packs";
import { assertProject } from "../domain/parse";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from "../domain/time";
import { createFactoryAsset } from "../library/factoryLibrary";

/**
 * Builds a fresh `FND-009` starter project: one sampler track ("BD") whose
 * asset resolves through a real factory pack from the generated library
 * manifest (`src/library/factoryLibrary.ts`), and a one-bar four-on-the-floor note clip
 * placed once — the same shape `src/domain/fixtures.ts`'s
 * `createSliceFixtureProject` pins for tests, but with real (non-seeded) IDs
 * and the current time, for "New Project" to hand to the repository.
 *
 * This is deliberately the smallest project the `FND-009` 16-step slice needs
 * to be playable immediately, not the richer dashboard creation flow
 * (blank/template/duplicate, genre, etc.) — that is `LOOP-001`'s scope.
 */
export function createStarterProject(ownerId: string): Project {
	const context = createFactoryContext();

	// `CNT-001`: the sound, its pack, its delivery path, and its audio metadata
	// all come from the generated manifest. Nothing here restates them, so the
	// starter cannot drift from the library it resolves against.
	const asset = createFactoryAsset(context, "starterKick");

	const track = createTrack(context, {
		name: "BD",
		order: 0,
		instrument: createSamplerInstrument(asset.id),
	});

	const clip = createNoteClip(context, {
		trackId: track.id,
		name: "Four on the floor",
		lengthTicks: TICKS_PER_BAR,
		events: [0, 4, 8, 12].map((sixteenth) =>
			createNoteEvent(context, {
				startTicks: sixteenth * TICKS_PER_SIXTEENTH,
				durationTicks: TICKS_PER_SIXTEENTH,
				pitch: 36,
			}),
		),
	});

	const placement = createPlacement(context, {
		clipId: clip.id,
		trackId: track.id,
		startTicks: 0,
		durationTicks: TICKS_PER_BAR,
	});

	const song: Song = {
		...createEmptySong(120),
		tracks: [track],
		placements: [placement],
		assets: [asset],
	};

	return assertProject({
		metadata: createProjectMetadata(context, {
			ownerId,
			name: "Untitled Project",
			template: "starter",
			packDependencies: derivePackDependencies(song),
		}),
		song,
		clips: [clip],
	});
}
