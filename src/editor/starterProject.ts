import type { Project, Song } from "../domain/entities";
import {
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
} from "../domain/factories";
import { derivePackDependencies } from "../domain/packs";
import { assertProject } from "../domain/parse";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from "../domain/time";

/**
 * Builds a fresh `FND-009` starter project: one sampler track ("BD") whose
 * asset resolves through a pack, and a one-bar four-on-the-floor note clip
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

	const pack = createPack(context, {
		name: "House Drums",
		description: "Bundled factory drum one-shots.",
	});

	const asset = createAsset(context, {
		pack,
		name: "909 Bass Drum",
		storageRef: "samples/house/drums/bd/909-bd.wav",
		url: "/samples/house/drums/bd/909-bd.wav",
		durationSeconds: 0.6,
		sampleRate: 44_100,
		channelCount: 1,
	});

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
			template: "blank",
			packDependencies: derivePackDependencies(song),
		}),
		song,
		clips: [clip],
	});
}
