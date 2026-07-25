import { describe, expect, it } from "vitest";
import type { Project } from "../domain/entities";
import {
	createReferenceProject,
	createSliceFixtureProject,
} from "../domain/fixtures";
import { buildProjectSummaryProjection } from "./projectSummaryProjection";

describe("buildProjectSummaryProjection", () => {
	it("summarizes metadata and counts without needing clip content", () => {
		const project = createSliceFixtureProject();
		const summary = buildProjectSummaryProjection(project);

		expect(summary.id).toBe(project.metadata.id);
		expect(summary.name).toBe(project.metadata.name);
		expect(summary.ownerId).toBe(project.metadata.ownerId);
		expect(summary.trackCount).toBe(1);
		expect(summary.clipCount).toBe(1);
		expect(summary.placementCount).toBe(1);
	});

	it("does not mutate the source project", () => {
		const project = createSliceFixtureProject();
		const before = JSON.parse(JSON.stringify(project));
		buildProjectSummaryProjection(project);
		expect(JSON.parse(JSON.stringify(project))).toEqual(before);
	});

	describe("referential stability", () => {
		it("reuses the previous summary when nothing summarized changed", () => {
			const project = createSliceFixtureProject();
			const before = buildProjectSummaryProjection(project);
			const after = buildProjectSummaryProjection(project, before);
			expect(after).toBe(before);
		});

		it("rebuilds when the project name changes", () => {
			const project = createSliceFixtureProject();
			const before = buildProjectSummaryProjection(project);

			const renamed: Project = {
				...project,
				metadata: { ...project.metadata, name: "New name" },
			};
			const after = buildProjectSummaryProjection(renamed, before);

			expect(after).not.toBe(before);
			expect(after.name).toBe("New name");
		});

		it("does not rebuild for an unrelated song edit that changes no summarized field", () => {
			const project = createSliceFixtureProject();
			const before = buildProjectSummaryProjection(project);

			const edited: Project = {
				...project,
				song: {
					...project.song,
					tracks: project.song.tracks.map((track) => ({
						...track,
						mixer: { ...track.mixer, volume: -6 },
					})),
				},
			};
			const after = buildProjectSummaryProjection(edited, before);

			expect(after).toBe(before);
		});
	});

	describe("empty state", () => {
		it("summarizes a project with no tracks, clips, or placements", () => {
			const project = createSliceFixtureProject();
			const emptied: Project = {
				...project,
				song: { ...project.song, tracks: [], placements: [], sections: [] },
				clips: [],
			};
			const summary = buildProjectSummaryProjection(emptied);
			expect(summary.trackCount).toBe(0);
			expect(summary.clipCount).toBe(0);
			expect(summary.placementCount).toBe(0);
			expect(summary.sectionCount).toBe(0);
		});
	});

	describe("large fixtures", () => {
		it("summarizes the 50-track reference project", () => {
			const project = createReferenceProject();
			const summary = buildProjectSummaryProjection(project);
			expect(summary.trackCount).toBe(50);
			expect(summary.clipCount).toBe(project.clips.length);
			expect(summary.placementCount).toBe(project.song.placements.length);
		});
	});
});
