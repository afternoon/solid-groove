import { describe, expect, it } from "vitest";
import { duplicateTrack } from "./duplicateTrack";
import { createFactoryContext, createReturnBus, createSend } from "./factories";
import { createDrumMachineFixtureProject } from "./fixtures";
import { createSeededIdFactory } from "./ids";
import { assertProject } from "./parse";

/**
 * Track duplication is an independent deep copy (PRD TRK-01): every mutable
 * entity the copy owns gets a fresh ID, every reference is rewritten to match,
 * and routing to song-level returns is preserved rather than duplicated.
 */
describe("duplicateTrack", () => {
	const ids = () => createSeededIdFactory("dup-track");

	it("mints fresh IDs for the track and every entity it owns", () => {
		const project = createDrumMachineFixtureProject();
		const source = project.song.tracks[0];
		const sourceClips = project.clips.filter((c) => c.trackId === source.id);

		const dup = duplicateTrack(project, source.id, { ids: ids() });

		expect(dup.track.id).not.toBe(source.id);
		// Devices and drum pads are fresh.
		for (const device of dup.track.devices) {
			expect(source.devices.some((d) => d.id === device.id)).toBe(false);
		}
		if (dup.track.instrument?.kind === "drumMachine") {
			const sourcePadIds = new Set(
				source.instrument?.kind === "drumMachine"
					? source.instrument.pads.map((p) => p.id)
					: [],
			);
			for (const pad of dup.track.instrument.pads) {
				expect(sourcePadIds.has(pad.id)).toBe(false);
			}
		}
		// Clips, their note events, and placements are fresh but same in number.
		expect(dup.clips).toHaveLength(sourceClips.length);
		const sourceClipIds = new Set(sourceClips.map((c) => c.id));
		for (const clip of dup.clips) {
			expect(sourceClipIds.has(clip.id)).toBe(false);
			expect(clip.trackId).toBe(dup.track.id);
		}
	});

	it("rewrites pad triggers in duplicated clips to the fresh pad IDs", () => {
		const project = createDrumMachineFixtureProject();
		const drumTrack = project.song.tracks.find(
			(t) => t.instrument?.kind === "drumMachine",
		);
		expect(drumTrack).toBeDefined();
		if (!drumTrack) return;

		const dup = duplicateTrack(project, drumTrack.id, { ids: ids() });
		const newPadIds = new Set(
			dup.track.instrument?.kind === "drumMachine"
				? dup.track.instrument.pads.map((p) => p.id)
				: [],
		);

		for (const clip of dup.clips) {
			if (clip.content.kind !== "notes") continue;
			for (const event of clip.content.events) {
				if (event.trigger.kind === "pad") {
					expect(newPadIds.has(event.trigger.padId)).toBe(true);
				}
			}
		}
	});

	it("preserves send routing to the same (unduplicated) return buses", () => {
		const base = createDrumMachineFixtureProject();
		// Give the drum track a send to a fresh return bus, then re-validate.
		const context = createFactoryContext({
			ids: createSeededIdFactory("dup-send"),
		});
		const bus = createReturnBus(context, { name: "Reverb", order: 0 });
		const source = base.song.tracks[0];
		const project = assertProject({
			metadata: base.metadata,
			song: {
				...base.song,
				returns: [bus],
				tracks: base.song.tracks.map((t) =>
					t.id === source.id
						? { ...t, sendConfig: [createSend(bus.id, 0.5)] }
						: t,
				),
			},
			clips: base.clips,
		});

		const withSend = project.song.tracks.find((t) => t.id === source.id);
		if (!withSend) throw new Error("source track missing");
		const dup = duplicateTrack(project, withSend.id, { ids: ids() });

		expect(dup.track.sendConfig).toHaveLength(1);
		// A returnId names a song-level bus that is NOT duplicated: the copy routes
		// to the same return the source did.
		expect(dup.track.sendConfig[0].returnId).toBe(bus.id);
		expect(dup.track.sendConfig[0].level).toBe(0.5);
	});

	it("inserts the copy right after the source by default", () => {
		const project = createDrumMachineFixtureProject();
		const source = project.song.tracks[0];
		const dup = duplicateTrack(project, source.id, { ids: ids() });
		expect(dup.track.order).toBe(source.order + 1);
		expect(dup.track.name).toBe(`${source.name} copy`);
	});

	it("produces a project that still validates when inserted", () => {
		const project = createDrumMachineFixtureProject();
		const source = project.song.tracks[0];
		const dup = duplicateTrack(project, source.id, { ids: ids() });

		const nextTracks = [
			...project.song.tracks.map((t) =>
				t.order >= dup.track.order ? { ...t, order: t.order + 1 } : t,
			),
			dup.track,
		].sort((a, b) => a.order - b.order);

		expect(() =>
			assertProject({
				metadata: project.metadata,
				song: {
					...project.song,
					tracks: nextTracks,
					placements: [...project.song.placements, ...dup.placements],
					automation: [...project.song.automation, ...dup.automation],
				},
				clips: [...project.clips, ...dup.clips],
			}),
		).not.toThrow();
	});

	it("throws for an unknown track", () => {
		const project = createDrumMachineFixtureProject();
		expect(() =>
			duplicateTrack(project, "trk_missing" as never, { ids: ids() }),
		).toThrow(/does not exist/);
	});
});
