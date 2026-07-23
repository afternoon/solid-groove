import { describe, expect, it } from "vitest";
import { newProject } from "./newProject";

describe("newProject", () => {
	it("assigns the given owner and sensible defaults", () => {
		const project = newProject("user-123");
		expect(project.ownerId).toBe("user-123");
		expect(project.isPublic).toBe(false);
		expect(project.latestSnapshot.song.tempo).toBe(120);
	});

	it("creates one sequence per track", () => {
		const project = newProject("user-123");
		const { tracks, patterns } = project.latestSnapshot.song;
		expect(patterns).toHaveLength(1);
		expect(patterns[0].sequences).toHaveLength(tracks.length);
	});

	it("pre-loads a four-on-the-floor groove so playback makes sound", () => {
		const project = newProject("user-123");
		const [bd, oh] = project.latestSnapshot.song.patterns[0].sequences;

		// BD on the downbeats (1-based steps 1,5,9,13 → indices 0,4,8,12)
		expect(bd.steps.filter((s) => s !== null)).toHaveLength(4);
		expect(bd.steps[0]).toBe("C3");
		expect(bd.steps[4]).toBe("C3");
		expect(bd.steps[8]).toBe("C3");
		expect(bd.steps[12]).toBe("C3");

		// OH on the offbeats (steps 3,7,11,15 → indices 2,6,10,14)
		expect(oh.steps.filter((s) => s !== null)).toHaveLength(4);
		expect(oh.steps[2]).toBe("C4");
		expect(oh.steps[6]).toBe("C4");
		expect(oh.steps[10]).toBe("C4");
		expect(oh.steps[14]).toBe("C4");
	});

	it("references sample files that exist in the public directory", () => {
		const project = newProject("user-123");
		for (const track of project.latestSnapshot.song.tracks) {
			if (track.instrument.type === "sampler") {
				expect(track.instrument.sampleUrl).toMatch(/^\/samples\/.+\.wav$/);
			}
		}
	});
});
